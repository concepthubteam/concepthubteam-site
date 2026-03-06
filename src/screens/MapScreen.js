import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  TouchableOpacity, ScrollView, ActivityIndicator, Image,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../constants/colors';
import { CATEGORIES, FILTERS } from '../data/mockData';
import EventCard from '../components/EventCard';
import { matchesFilter } from '../utils/filterUtils';
import { useEvents } from '../context/EventsContext';
import { useCityPulse } from '../context/CityPulseContext';
import { HEAT_CONFIG } from '../components/HeatBadge';

const LOGO = require('../../assets/logo.png');

const BUCHAREST = {
  latitude: 44.4368,
  longitude: 26.0976,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

const filterColors = {
  today:    '#FF7334',
  tomorrow: '#3B82F6',
  weekend:  '#8B5CF6',
  week:     '#10B981',
};

function getCategoryIcon(category) {
  const icons = {
    events: '🎉', restaurants: '🍽️', clubs: '🎶',
    kids: '👶', parks: '🌳', cinema: '🎬',
    sport: '🏋️', theatre: '🎭',
  };
  return icons[category] || '📍';
}

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Marker custom pentru heat venues
function HeatMarker({ venue }) {
  const cfg = HEAT_CONFIG[venue.heat_level] || HEAT_CONFIG.chill;
  return (
    <View style={[styles.heatMarkerWrap]}>
      {/* Inel pulsant pentru packed */}
      {venue.heat_level === 'packed' && (
        <View style={[styles.heatRing, { borderColor: cfg.color }]} />
      )}
      <View style={[styles.heatMarker, { backgroundColor: cfg.color }]}>
        <Text style={styles.heatMarkerIcon}>{cfg.icon}</Text>
      </View>
    </View>
  );
}

export default function MapScreen({ navigation }) {
  const { events }             = useEvents();
  const { heatData, optedIn }  = useCityPulse();

  const [selectedCat,   setSelectedCat]   = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [dateFilter,    setDateFilter]    = useState('today');
  const [userLocation,  setUserLocation]  = useState(null);
  const [locLoading,    setLocLoading]    = useState(false);
  const [showHeat,      setShowHeat]      = useState(true);   // toggle heat overlay
  const mapRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      setLocLoading(true);
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserLocation(loc.coords);
      setLocLoading(false);
    })();
  }, []);

  const filtered = events
    .filter(e => {
      if (!matchesFilter(e, dateFilter)) return false;
      if (selectedCat && e.category !== selectedCat) return false;
      return true;
    })
    .sort((a, b) => {
      if (!userLocation) return 0;
      const dA = getDistanceKm(userLocation.latitude, userLocation.longitude, a.lat, a.lng);
      const dB = getDistanceKm(userLocation.latitude, userLocation.longitude, b.lat, b.lng);
      return dA - dB;
    });

  // Heat venues cu coordonate valide
  const heatVenues = heatData.filter(v =>
    v.venue_lat && v.venue_lng &&
    Math.abs(v.venue_lat - 44.4368) < 1 // sanity check — în București
  );

  const recenterUser = async () => {
    if (locLoading) return;
    setLocLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserLocation(loc.coords);
      mapRef.current?.animateToRegion({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.04,
        longitudeDelta: 0.04,
      }, 500);
    } finally {
      setLocLoading(false);
    }
  };

  const focusEvent = (event) => {
    setSelectedEvent(event);
    mapRef.current?.animateToRegion({
      latitude: event.lat,
      longitude: event.lng,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    }, 400);
  };

  const hasActiveHeat = heatVenues.some(v =>
    v.heat_level === 'busy' || v.heat_level === 'packed'
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <View style={styles.header}>
        <Image source={LOGO} style={styles.logoImg} resizeMode="contain" />
      </View>

      {/* Date filter + City Pulse toggle */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.dateScroll}
        contentContainerStyle={styles.dateRow}
      >
        {FILTERS.map(f => {
          const active = dateFilter === f.id;
          return (
            <TouchableOpacity
              key={f.id}
              style={[
                styles.dateChip,
                { borderColor: active ? filterColors[f.id] : `${filterColors[f.id]}50` },
                active && { backgroundColor: filterColors[f.id] },
              ]}
              onPress={() => { setDateFilter(f.id); setSelectedEvent(null); }}
            >
              {!active && <View style={[styles.dateChipDot, { backgroundColor: filterColors[f.id] }]} />}
              <Text style={[styles.dateChipText, active && { color: '#fff', fontWeight: '800' }]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}

        {/* Separator */}
        <View style={styles.chipSep} />

        {/* City Pulse toggle chip */}
        <TouchableOpacity
          style={[
            styles.dateChip,
            styles.heatToggleChip,
            showHeat && styles.heatToggleChipActive,
            hasActiveHeat && showHeat && styles.heatToggleChipLive,
          ]}
          onPress={() => setShowHeat(v => !v)}
        >
          {hasActiveHeat && showHeat && <View style={styles.liveDot} />}
          <Text style={styles.dateChipText}>
            {showHeat ? '🔥 Pulse ON' : '🔥 Pulse'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_DEFAULT}
          initialRegion={BUCHAREST}
          userInterfaceStyle="dark"
          showsUserLocation
          showsMyLocationButton={false}
          showsCompass={false}
          customMapStyle={darkMapStyle}
        >
          {/* Event markers */}
          {filtered.map(event => {
            const catColor = COLORS.cat[event.category] || COLORS.accent;
            const isSelected = selectedEvent?.id === event.id;
            return (
              <Marker
                key={`ev-${event.id}`}
                coordinate={{ latitude: event.lat, longitude: event.lng }}
                onPress={() => focusEvent(event)}
              >
                <View style={[
                  styles.markerContainer,
                  { backgroundColor: catColor },
                  isSelected && styles.markerSelected,
                ]}>
                  <Text style={styles.markerIcon}>{getCategoryIcon(event.category)}</Text>
                </View>
              </Marker>
            );
          })}

          {/* City Pulse heat markers */}
          {showHeat && heatVenues.map(venue => (
            <Marker
              key={`heat-${venue.venue_id}`}
              coordinate={{ latitude: Number(venue.venue_lat), longitude: Number(venue.venue_lng) }}
              onPress={() => navigation.navigate('CityPulse')}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <HeatMarker venue={venue} />
            </Marker>
          ))}
        </MapView>

        {/* Popup eveniment selectat */}
        {selectedEvent && (() => {
          const catColor = COLORS.cat[selectedEvent.category] || COLORS.accent;
          return (
            <TouchableOpacity
              style={styles.mapPopup}
              onPress={() => navigation.navigate('EventDetail', { event: selectedEvent })}
              activeOpacity={0.9}
            >
              <View style={[styles.popupThumb, { backgroundColor: `${catColor}22` }]}>
                {selectedEvent.image ? (
                  <Image
                    source={{ uri: selectedEvent.image }}
                    style={styles.popupThumbImg}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.popupThumbIcon}>{getCategoryIcon(selectedEvent.category)}</Text>
                )}
              </View>

              <View style={styles.popupBody}>
                <View style={styles.popupTitleRow}>
                  <Text style={styles.popupTitle} numberOfLines={1}>{selectedEvent.title}</Text>
                  {selectedEvent.price === 'Gratuit' && (
                    <View style={styles.popupFreeBadge}>
                      <Text style={styles.popupFreeBadgeText}>FREE</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.popupMeta} numberOfLines={1}>
                  ⏰ {selectedEvent.time} · 📍 {selectedEvent.venue}
                </Text>
                <View style={styles.popupBottom}>
                  <Text style={[styles.popupDate, { color: catColor }]}>{selectedEvent.date}</Text>
                  <Text style={styles.popupRating}>★ {selectedEvent.rating}</Text>
                </View>
              </View>

              <View style={[styles.popupArrowWrap, { backgroundColor: catColor }]}>
                <Text style={styles.popupArrow}>→</Text>
              </View>
            </TouchableOpacity>
          );
        })()}

        {/* Counter overlay + heat info */}
        <View style={styles.counterBadge}>
          <Text style={styles.counterText}>
            {filtered.length} locații
            {showHeat && heatVenues.length > 0 ? ` · 🔥 ${heatVenues.length} active` : ''}
          </Text>
        </View>

        {/* Recenter button */}
        <TouchableOpacity style={styles.recenterBtn} onPress={recenterUser} activeOpacity={0.8}>
          {locLoading
            ? <ActivityIndicator size="small" color={COLORS.accent} />
            : <Text style={styles.recenterIcon}>◎</Text>
          }
        </TouchableOpacity>

        {/* City Pulse CTA — apare când heat e activ și există venues */}
        {showHeat && heatVenues.length > 0 && (
          <TouchableOpacity
            style={styles.heatCTA}
            onPress={() => navigation.navigate('CityPulse')}
            activeOpacity={0.85}
          >
            <Text style={styles.heatCTAText}>
              🔥 {heatVenues.filter(v => v.heat_level === 'packed' || v.heat_level === 'busy').length} locuri active → City Pulse
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Category filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chips}
      >
        <TouchableOpacity
          style={[styles.chip, styles.chipTuate, !selectedCat && styles.chipTuateActive]}
          onPress={() => { setSelectedCat(null); setSelectedEvent(null); }}
        >
          <Text style={[styles.chipText, !selectedCat && styles.chipTextActive]}>Toate</Text>
        </TouchableOpacity>
        {CATEGORIES.map(c => (
          <TouchableOpacity
            key={c.id}
            style={[styles.chip, selectedCat === c.id && { borderColor: c.color, borderWidth: 2 }]}
            onPress={() => {
              setSelectedCat(selectedCat === c.id ? null : c.id);
              setSelectedEvent(null);
            }}
          >
            {c.image && (
              <Image
                source={{ uri: c.image }}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
              />
            )}
            <LinearGradient
              colors={
                selectedCat === c.id
                  ? [`${c.color}BB`, `${c.color}EE`]
                  : ['rgba(0,0,0,0.25)', 'rgba(0,0,0,0.72)']
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <Text style={styles.chipText}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Lista rezultate */}
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        <Text style={styles.listLabel}>{filtered.length} LOCAȚII</Text>
        {filtered.map(e => (
          <EventCard
            key={e.id}
            event={e}
            onPress={() => {
              focusEvent(e);
              navigation.navigate('EventDetail', { event: e });
            }}
          />
        ))}
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a1a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#888888' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c2c2c' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#333333' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#222222' }] },
];

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  logoImg: { width: 110, height: 38, borderRadius: 0 },

  dateScroll: { flexGrow: 0 },
  dateRow: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateChip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    marginRight: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dateChipDot: { width: 5, height: 5, borderRadius: 3 },
  dateChipText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },

  chipSep: { width: 1, height: 20, backgroundColor: COLORS.border, marginHorizontal: 4 },

  heatToggleChip: {
    borderColor: 'rgba(239,68,68,0.4)',
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  heatToggleChipActive: {
    borderColor: 'rgba(239,68,68,0.7)',
    backgroundColor: 'rgba(239,68,68,0.15)',
  },
  heatToggleChipLive: {
    borderColor: '#EF4444',
    backgroundColor: 'rgba(239,68,68,0.2)',
  },
  liveDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#EF4444',
  },

  mapContainer: { height: 200, position: 'relative' },
  map: { flex: 1 },

  markerContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
  markerSelected: { width: 44, height: 44, borderRadius: 22, borderWidth: 3 },
  markerIcon: { fontSize: 16 },

  // Heat markers
  heatMarkerWrap: { alignItems: 'center', justifyContent: 'center' },
  heatRing: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    opacity: 0.5,
  },
  heatMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 8,
  },
  heatMarkerIcon: { fontSize: 18 },

  heatCTA: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(239,68,68,0.85)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  heatCTAText: { fontSize: 11, color: '#fff', fontWeight: '700' },

  mapPopup: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  popupThumb: {
    width: 64, height: 64,
    margin: 10, marginRight: 0,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  popupThumbImg: { width: 64, height: 64 },
  popupThumbIcon: { fontSize: 28 },
  popupBody: { flex: 1, paddingVertical: 10, paddingHorizontal: 12 },
  popupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  popupTitle: { flex: 1, fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  popupFreeBadge: {
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(34,197,94,0.2)',
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.4)',
  },
  popupFreeBadgeText: { fontSize: 9, fontWeight: '700', color: '#22C55E' },
  popupMeta: { fontSize: 11, color: COLORS.textSecondary },
  popupBottom: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 5,
  },
  popupDate: { fontSize: 10, fontWeight: '700' },
  popupRating: { fontSize: 11, fontWeight: '700', color: COLORS.accent },
  popupArrowWrap: {
    width: 36, alignSelf: 'stretch',
    alignItems: 'center', justifyContent: 'center',
  },
  popupArrow: { fontSize: 16, color: '#fff', fontWeight: '700' },

  counterBadge: {
    position: 'absolute',
    top: 10, right: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  counterText: { fontSize: 11, color: '#fff', fontWeight: '600' },

  recenterBtn: {
    position: 'absolute',
    bottom: 12, right: 12,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.accentMid,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
  recenterIcon: { fontSize: 20, color: COLORS.accent },

  chipsScroll: { flexGrow: 0 },
  chips: {
    paddingHorizontal: 12, paddingVertical: 7,
    gap: 6, flexDirection: 'row', alignItems: 'center',
  },
  chip: {
    width: 72, height: 48,
    borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
    marginRight: 8,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', position: 'relative',
  },
  chipTuate: {
    width: 'auto', paddingHorizontal: 14,
    backgroundColor: COLORS.surface,
  },
  chipTuateActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft },
  chipText: { fontSize: 10, fontWeight: '700', color: '#fff', textAlign: 'center' },
  chipTextActive: { color: COLORS.accent },

  list: { flex: 1, paddingHorizontal: 16 },
  listLabel: {
    fontSize: 9, fontWeight: '700',
    color: COLORS.textMuted, letterSpacing: 1.5, paddingVertical: 10,
  },
});
