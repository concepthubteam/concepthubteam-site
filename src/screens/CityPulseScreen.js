import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, StatusBar, ActivityIndicator,
  Modal, Animated, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { COLORS } from '../constants/colors';
import { useCityPulse } from '../context/CityPulseContext';
import HeatBadge, { HeatDot, HeatBar, HEAT_CONFIG } from '../components/HeatBadge';
import { distanceMeters } from '../context/CityPulseContext';

// ── Animatie pulse pentru header ─────────────────────────────────────────────
function PulseRing({ color = '#EF4444', size = 60 }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 2000, useNativeDriver: true })
    ).start();
  }, [anim]);
  const scale  = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] });
  const opacity = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0.2, 0] });
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[styles.ring, {
        width: size, height: size, borderRadius: size / 2,
        borderColor: color, transform: [{ scale }], opacity,
      }]} />
      <View style={[styles.ringCore, {
        width: size * 0.5, height: size * 0.5, borderRadius: size * 0.25,
        backgroundColor: color,
      }]} />
    </View>
  );
}

// ── Card venue ───────────────────────────────────────────────────────────────
function VenueHeatCard({ venue, onCheckIn, userLocation, rank }) {
  const cfg = HEAT_CONFIG[venue.heat_level] || HEAT_CONFIG.chill;
  const dist = userLocation && venue.venue_lat && venue.venue_lng
    ? distanceMeters(
        userLocation.latitude, userLocation.longitude,
        Number(venue.venue_lat), Number(venue.venue_lng)
      )
    : null;
  const distLabel = dist !== null
    ? dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`
    : null;

  return (
    <TouchableOpacity style={styles.venueCard} activeOpacity={0.85} onPress={onCheckIn}>
      {/* Rank number */}
      <View style={[styles.rankBubble, { backgroundColor: cfg.color + '22', borderColor: cfg.color + '44' }]}>
        <Text style={[styles.rankText, { color: cfg.color }]}>{rank}</Text>
      </View>

      {/* Info */}
      <View style={styles.venueInfo}>
        <View style={styles.venueRow}>
          <Text style={styles.venueName} numberOfLines={1}>{venue.venue_name || `Venue ${venue.venue_id}`}</Text>
          <HeatBadge level={venue.heat_level} size="sm" pulse={venue.heat_level === 'packed'} />
        </View>

        <View style={styles.venueMeta}>
          {venue.active_users_estimate > 0 && (
            <Text style={styles.metaChip}>
              👤 {venue.active_users_estimate} activi acum
            </Text>
          )}
          {distLabel && (
            <Text style={styles.metaChip}>📍 {distLabel}</Text>
          )}
        </View>

        <HeatBar score={venue.heat_score} />
      </View>

      {/* Check-in arrow */}
      <Text style={[styles.checkInArrow, { color: cfg.color }]}>›</Text>
    </TouchableOpacity>
  );
}

// ── Sectiune principala ───────────────────────────────────────────────────────
export default function CityPulseScreen({ navigation }) {
  const { heatData, loading, optedIn, setOptIn, checkIn, checkGpsProximity, refresh } = useCityPulse();
  const [userLocation, setUserLocation]     = useState(null);
  const [checkInModal, setCheckInModal]     = useState(false);
  const [nearestVenue, setNearestVenue]     = useState(null);
  const [activeTab, setActiveTab]           = useState('list'); // 'list' | 'nearby'
  const [refreshing, setRefreshing]         = useState(false);

  const headerAnim = useRef(new Animated.Value(0)).current;

  // Fade-in la mount
  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  // GPS la deschidere
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserLocation(loc.coords);
      if (optedIn && heatData.length) {
        checkGpsProximity(heatData);
      }
    })();
  }, [optedIn]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  // ── Check-in flow ────────────────────────────────────────────────────────
  const handleCheckIn = (venue) => {
    setNearestVenue(venue);
    setCheckInModal(true);
  };

  const confirmCheckIn = async () => {
    if (!nearestVenue) return;
    await checkIn(nearestVenue.venue_id);
    setCheckInModal(false);
    Alert.alert(
      '🔥 Check-in confirmat!',
      `Ești la ${nearestVenue.venue_name}. Mulțumim că ajuți comunitatea să știe unde e viața în città!`,
      [{ text: 'Super!', style: 'default' }]
    );
  };

  // ── Partitionare date ────────────────────────────────────────────────────
  const packed   = heatData.filter(v => v.heat_level === 'packed');
  const busy     = heatData.filter(v => v.heat_level === 'busy');
  const moderate = heatData.filter(v => v.heat_level === 'moderate');
  const chill    = heatData.filter(v => v.heat_level === 'chill');

  const nearbyData = userLocation
    ? heatData
        .filter(v => v.venue_lat && v.venue_lng)
        .map(v => ({
          ...v,
          _dist: distanceMeters(
            userLocation.latitude, userLocation.longitude,
            Number(v.venue_lat), Number(v.venue_lng)
          ),
        }))
        .filter(v => v._dist <= 2000)
        .sort((a, b) => b.heat_score - a.heat_score)
    : [];

  const activeCount = heatData.filter(v => v.heat_level !== 'chill').length;

  // ── OPT-IN wall ──────────────────────────────────────────────────────────
  if (!optedIn) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
        <Animated.View style={[styles.optInScreen, { opacity: headerAnim }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>

          <View style={styles.optInHero}>
            <PulseRing color="#EF4444" size={80} />
            <Text style={styles.optInTitle}>City Pulse</Text>
            <Text style={styles.optInSub}>
              Radarul de noapte al Bucureștiului
            </Text>
          </View>

          <View style={styles.optInFeatures}>
            {[
              ['🔥', 'Locuri packed tonight', 'Află unde e aglomerație în timp real'],
              ['📍', 'Vibe-ul în 2km', 'Ce se întâmplă lângă tine chiar acum'],
              ['🔒', '100% anonim', 'Nu stocăm locația ta exactă niciodată'],
            ].map(([icon, title, desc]) => (
              <View key={title} style={styles.optInFeature}>
                <Text style={styles.optInFeatureIcon}>{icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optInFeatureTitle}>{title}</Text>
                  <Text style={styles.optInFeatureDesc}>{desc}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.privacyNote}>
            <Text style={styles.privacyText}>
              🔐 Cum funcționează: când deschizi GOZI, trimitem un semnal anonim
              dacă ești lângă un venue (max 1 semnal / 5 min). Nu vedem unde ești
              exact și nu stocăm istoricul locației tale. Datele se șterg automat
              după 48h.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.optInBtn}
            onPress={() => setOptIn(true)}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={['#FF7334', '#EF4444']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={styles.optInBtnGradient}
            >
              <Text style={styles.optInBtnText}>🔥  Activează City Pulse</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.skipBtn}>
            <Text style={styles.skipBtnText}>Nu acum</Text>
          </TouchableOpacity>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // ── Main screen ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>🔥 City Pulse</Text>
          <Text style={styles.headerSub}>
            {activeCount > 0
              ? `${activeCount} locuri active acum în București`
              : 'Linișcit în oraș acum'}
          </Text>
        </View>
        <TouchableOpacity onPress={handleRefresh} style={styles.refreshBtn}>
          {refreshing
            ? <ActivityIndicator size="small" color={COLORS.accent} />
            : <Text style={styles.refreshIcon}>↻</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {[
          { id: 'list', label: '🏙️ Tot orașul' },
          { id: 'nearby', label: `📍 Lângă tine (${nearbyData.length})` },
        ].map(tab => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tab, activeTab === tab.id && styles.tabActive]}
            onPress={() => setActiveTab(tab.id)}
          >
            <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loaderText}>Se încarcă vibrația orașului...</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
          {activeTab === 'nearby' ? (
            // ── TAB NEARBY ────────────────────────────────────────────────
            <View style={styles.section}>
              {!userLocation ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyIcon}>📍</Text>
                  <Text style={styles.emptyTitle}>Locație necesară</Text>
                  <Text style={styles.emptyText}>Activează GPS pentru a vedea vibe-ul din jurul tău</Text>
                </View>
              ) : nearbyData.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyIcon}>🌙</Text>
                  <Text style={styles.emptyTitle}>Liniște în jur</Text>
                  <Text style={styles.emptyText}>Nu e activitate în 2km față de tine acum</Text>
                </View>
              ) : (
                nearbyData.map((v, i) => (
                  <VenueHeatCard
                    key={v.venue_id}
                    venue={v}
                    rank={i + 1}
                    userLocation={userLocation}
                    onCheckIn={() => handleCheckIn(v)}
                  />
                ))
              )}
            </View>
          ) : (
            // ── TAB TOT ORASUL ────────────────────────────────────────────
            <>
              {/* Packed */}
              {packed.length > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHead}>
                    <Text style={styles.sectionLabel}>🔥 PACKED TONIGHT</Text>
                    <View style={[styles.levelDot, { backgroundColor: '#EF4444' }]} />
                  </View>
                  {packed.map((v, i) => (
                    <VenueHeatCard key={v.venue_id} venue={v} rank={i + 1}
                      userLocation={userLocation} onCheckIn={() => handleCheckIn(v)} />
                  ))}
                </View>
              )}

              {/* Busy */}
              {busy.length > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHead}>
                    <Text style={styles.sectionLabel}>🟠 BUSY</Text>
                    <View style={[styles.levelDot, { backgroundColor: '#FF7334' }]} />
                  </View>
                  {busy.map((v, i) => (
                    <VenueHeatCard key={v.venue_id} venue={v} rank={i + 1}
                      userLocation={userLocation} onCheckIn={() => handleCheckIn(v)} />
                  ))}
                </View>
              )}

              {/* Moderate */}
              {moderate.length > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHead}>
                    <Text style={styles.sectionLabel}>🟡 ACTIV</Text>
                    <View style={[styles.levelDot, { backgroundColor: '#F59E0B' }]} />
                  </View>
                  {moderate.map((v, i) => (
                    <VenueHeatCard key={v.venue_id} venue={v} rank={i + 1}
                      userLocation={userLocation} onCheckIn={() => handleCheckIn(v)} />
                  ))}
                </View>
              )}

              {/* Chill */}
              {chill.length > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHead}>
                    <Text style={styles.sectionLabel}>🟢 LINIȘTIT</Text>
                    <View style={[styles.levelDot, { backgroundColor: '#22C55E' }]} />
                  </View>
                  {chill.map((v, i) => (
                    <VenueHeatCard key={v.venue_id} venue={v} rank={i + 1}
                      userLocation={userLocation} onCheckIn={() => handleCheckIn(v)} />
                  ))}
                </View>
              )}

              {heatData.length === 0 && (
                <View style={styles.empty}>
                  <Text style={styles.emptyIcon}>🌙</Text>
                  <Text style={styles.emptyTitle}>Orașul doarme</Text>
                  <Text style={styles.emptyText}>
                    Nu e activitate înregistrată încă. Revino seara sau fii primul
                    care face check-in!
                  </Text>
                </View>
              )}
            </>
          )}

          {/* Check-in CTA */}
          <View style={styles.checkInSection}>
            <Text style={styles.checkInPrompt}>Ești undeva?</Text>
            <TouchableOpacity
              style={styles.checkInBtn}
              onPress={() => {
                const top = heatData[0];
                if (top) handleCheckIn(top);
              }}
              activeOpacity={0.88}
            >
              <LinearGradient
                colors={['#FF7334', '#EF4444']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={styles.checkInBtnGrad}
              >
                <Text style={styles.checkInBtnText}>🔥  Sunt aici!</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {/* Check-in Confirmation Modal */}
      <Modal
        visible={checkInModal}
        transparent
        animationType="slide"
        onRequestClose={() => setCheckInModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setCheckInModal(false)}
        />
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>📍 Check-in</Text>
          <Text style={styles.modalVenue}>
            {nearestVenue?.venue_name || 'Venue necunoscut'}
          </Text>
          <Text style={styles.modalDesc}>
            Confirmă prezența ta anonimă la acest venue. Ajuți alți utilizatori
            să vadă unde e viața în oraș.
          </Text>
          <HeatBadge level={nearestVenue?.heat_level || 'chill'} size="lg" />

          <TouchableOpacity style={styles.modalConfirmBtn} onPress={confirmCheckIn} activeOpacity={0.88}>
            <Text style={styles.modalConfirmText}>✅  Confirm check-in</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setCheckInModal(false)} style={styles.modalCancelBtn}>
            <Text style={styles.modalCancelText}>Anulează</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  backBtn:     { padding: 8 },
  backBtnText: { fontSize: 22, color: COLORS.textPrimary, fontWeight: '300' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: COLORS.textPrimary },
  headerSub:   { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  refreshBtn:  { padding: 8 },
  refreshIcon: { fontSize: 20, color: COLORS.accent },

  // ── Tabs ────────────────────────────────────────────────────────────────
  tabs: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  tab: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
  },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.accent },
  tabLabel:  { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  tabLabelActive: { color: COLORS.accent },

  // ── Section ─────────────────────────────────────────────────────────────
  section: { marginTop: 20, paddingHorizontal: 16 },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 10, fontWeight: '800', color: COLORS.textMuted,
    letterSpacing: 1.2, flex: 1,
  },
  levelDot: { width: 8, height: 8, borderRadius: 4 },

  // ── Venue Card ───────────────────────────────────────────────────────────
  venueCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 14, padding: 14,
    marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  rankBubble: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  rankText:   { fontSize: 13, fontWeight: '800', color: COLORS.textPrimary },
  venueInfo:  { flex: 1, gap: 6 },
  venueRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  venueName:  { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary, flex: 1, marginRight: 8 },
  venueMeta:  { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  metaChip:   { fontSize: 11, color: COLORS.textSecondary },
  checkInArrow: { fontSize: 22, fontWeight: '300' },

  // ── Check-in CTA ─────────────────────────────────────────────────────────
  checkInSection: {
    alignItems: 'center', marginTop: 32, marginHorizontal: 16,
  },
  checkInPrompt: { fontSize: 13, color: COLORS.textMuted, marginBottom: 10 },
  checkInBtn:    { width: '100%', borderRadius: 24, overflow: 'hidden' },
  checkInBtnGrad: { paddingVertical: 16, alignItems: 'center' },
  checkInBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },

  // ── Loader & Empty ────────────────────────────────────────────────────────
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loaderText: { fontSize: 14, color: COLORS.textSecondary },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon:  { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 6 },
  emptyText:  { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },

  // ── Modal ─────────────────────────────────────────────────────────────────
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' },
  modalSheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
    borderTopWidth: 1, borderTopColor: COLORS.border,
    gap: 12,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 8,
  },
  modalTitle:       { fontSize: 20, fontWeight: '900', color: COLORS.textPrimary },
  modalVenue:       { fontSize: 17, fontWeight: '700', color: COLORS.accent },
  modalDesc:        { fontSize: 13, color: COLORS.textSecondary, lineHeight: 20 },
  modalConfirmBtn:  {
    backgroundColor: COLORS.accent, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  modalConfirmText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  modalCancelBtn:   { alignItems: 'center', paddingVertical: 10 },
  modalCancelText:  { fontSize: 13, color: COLORS.textMuted },

  // ── Opt-in screen ─────────────────────────────────────────────────────────
  optInScreen: { flex: 1, paddingHorizontal: 24 },
  optInHero: { alignItems: 'center', marginTop: 40, marginBottom: 36, gap: 16 },
  optInTitle: { fontSize: 36, fontWeight: '900', color: COLORS.textPrimary },
  optInSub:   { fontSize: 15, color: COLORS.textSecondary, textAlign: 'center' },
  optInFeatures: { gap: 16, marginBottom: 28 },
  optInFeature:  { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  optInFeatureIcon:  { fontSize: 24, marginTop: 2 },
  optInFeatureTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 2 },
  optInFeatureDesc:  { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
  privacyNote: {
    backgroundColor: COLORS.surface,
    borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 24,
  },
  privacyText: { fontSize: 11, color: COLORS.textMuted, lineHeight: 17 },
  optInBtn: { borderRadius: 24, overflow: 'hidden', marginBottom: 12 },
  optInBtnGradient: { paddingVertical: 16, alignItems: 'center' },
  optInBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  skipBtn: { alignItems: 'center', paddingVertical: 10 },
  skipBtnText: { fontSize: 13, color: COLORS.textMuted },

  // ── Pulse ring ────────────────────────────────────────────────────────────
  ring: { position: 'absolute', borderWidth: 2 },
  ringCore: { position: 'absolute' },
});
