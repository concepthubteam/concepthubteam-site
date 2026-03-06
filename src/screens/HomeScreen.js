import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, StatusBar, TextInput, ActivityIndicator, Image,
  Modal, Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { COLORS } from '../constants/colors';
import { FILTERS } from '../data/mockData';
import EventCard from '../components/EventCard';
import CategoryGrid from '../components/CategoryGrid';
import { matchesFilter } from '../utils/filterUtils';
import { SkeletonListCard, SkeletonFeaturedCard } from '../components/SkeletonCard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEvents } from '../context/EventsContext';
import { useCityPulse } from '../context/CityPulseContext';
import { PREF_CATS_KEY } from './OnboardingScreen';

const LOGO = require('../../assets/logo.png');

const OPEN_NOW_CATS = [
  { id: null,          label: 'Toate',      icon: '🌟' },
  { id: 'parks',       label: 'Parcuri',    icon: '🌳' },
  { id: 'clubs',       label: 'Cluburi',    icon: '🎶' },
  { id: 'restaurants', label: 'Restaurante',icon: '🍽️' },
  { id: 'sport',       label: 'Sport',      icon: '🏋️' },
  { id: 'kids',        label: 'Copii',      icon: '👶' },
];

const DAYS   = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm'];
const MONTHS = ['Ian','Feb','Mar','Apr','Mai','Iun','Iul','Aug','Sep','Oct','Nov','Dec'];

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bună dimineața';
  if (h < 18) return 'Bună ziua';
  return 'Bună seara';
}

const FILTER_LABELS = { today: 'Azi', tomorrow: 'Mâine', weekend: 'Weekend', week: 'Săptămâna' };

const CAT_ICONS = {
  events: '🎉', restaurants: '🍽️', clubs: '🎶',
  kids: '👶', parks: '🌳', cinema: '🎬', sport: '🏋️', theatre: '🎭',
};

// ── Time-of-day category boost ────────────────────────────────────
// Morning (6-11): parks, sport, kids → +2
// Afternoon (11-17): restaurants, cinema, theatre, events → +2
// Evening (17-23): clubs, events, theatre, restaurants → +2
// Night (23-6): clubs → +3
function getTimeBoost(category) {
  const h = new Date().getHours();
  const isMorning   = h >= 6  && h < 11;
  const isAfternoon = h >= 11 && h < 17;
  const isEvening   = h >= 17 && h < 23;
  const isNight     = h >= 23 || h < 6;

  const boosts = {
    parks:       isMorning ? 2 : 0,
    sport:       isMorning ? 2 : (isAfternoon ? 1 : 0),
    kids:        isMorning || isAfternoon ? 2 : 0,
    restaurants: isAfternoon || isEvening ? 2 : (isMorning ? 1 : 0),
    cinema:      isAfternoon || isEvening ? 2 : 0,
    theatre:     isEvening ? 2 : (isAfternoon ? 1 : 0),
    events:      isAfternoon || isEvening ? 2 : 0,
    clubs:       isEvening ? 2 : (isNight ? 3 : 0),
  };
  return boosts[category] ?? 0;
}

// ── Distance boost (0–2 pts): closer = better ─────────────────────
function getDistanceBoost(event, userLocation) {
  if (!userLocation || !event.lat || !event.lng) return 1; // neutral
  const km = getDistanceKm(userLocation.latitude, userLocation.longitude, event.lat, event.lng);
  if (km < 1)  return 2;
  if (km < 3)  return 1.5;
  if (km < 5)  return 1;
  if (km < 10) return 0.5;
  return 0;
}

function getMagicSuggestions(events, userLocation) {
  const today = new Date().toISOString().split('T')[0];
  const candidates = events.filter(e => !e.dateISO || e.dateISO === today);
  const scored = candidates
    .map(e => ({
      ...e,
      _score:
        (e.featured ? 3 : 0) +
        (e.rating >= 4.5 ? 2 : e.rating >= 4.0 ? 1 : 0) +
        (e.price === 'Gratuit' ? 1 : 0) +
        getTimeBoost(e.category) +
        getDistanceBoost(e, userLocation) +
        Math.random() * 1.5,   // reduced random noise now that we have real signals
    }))
    .sort((a, b) => b._score - a._score);

  const picks = [];
  const usedCats = new Set();
  for (const e of scored) {
    if (picks.length >= 3) break;
    if (!usedCats.has(e.category)) { picks.push(e); usedCats.add(e.category); }
  }
  for (const e of scored) {
    if (picks.length >= 3) break;
    if (!picks.find(p => p.id === e.id)) picks.push(e);
  }
  return picks.slice(0, 3);
}

function getTonightEvents(events, userLocation) {
  const todayISO = new Date().toISOString().split('T')[0];
  const nowHour  = new Date().getHours();
  return events
    .filter(e => {
      if (e.dateISO !== todayISO || !e.time) return false;
      const h = parseInt(e.time.split(':')[0], 10);
      return !isNaN(h) && h >= nowHour && h <= nowHour + 3;
    })
    .map(e => userLocation
      ? { ...e, distance: formatDistance(getDistanceKm(userLocation.latitude, userLocation.longitude, e.lat, e.lng)) }
      : e
    )
    .slice(0, 5);
}

function getNearbyEvents(events, userLocation) {
  if (!userLocation) return [];
  return events
    .filter(e => getDistanceKm(userLocation.latitude, userLocation.longitude, e.lat, e.lng) < 2)
    .map(e => ({ ...e, distance: formatDistance(getDistanceKm(userLocation.latitude, userLocation.longitude, e.lat, e.lng)) }))
    .slice(0, 5);
}

export default function HomeScreen({ navigation }) {
  const { events } = useEvents();
  const { heatData } = useCityPulse();
  const [filter, setFilter]             = useState('today');
  const [category, setCategory]         = useState(null);
  const [search, setSearch]             = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [sortByDist, setSortByDist]     = useState(false);
  const [onlyFree, setOnlyFree]         = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [locLoading, setLocLoading]     = useState(false);
  const [openNowCat, setOpenNowCat]     = useState(null);
  const [loading, setLoading]           = useState(true);
  const [magicVisible, setMagicVisible] = useState(false);
  const [magicPicks, setMagicPicks]     = useState([]);
  const [prefCats, setPrefCats]         = useState([]);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.07, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 1100, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const showMagic = () => {
    setMagicPicks(getMagicSuggestions(events, userLocation));
    setMagicVisible(true);
  };

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 650);
    return () => clearTimeout(t);
  }, []);

  // Încarcă categoriile preferate setate în onboarding
  useEffect(() => {
    AsyncStorage.getItem(PREF_CATS_KEY).then(raw => {
      if (raw) {
        try { setPrefCats(JSON.parse(raw)); } catch (_) {}
      }
    });
  }, []);

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      setLocLoading(true);
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .then(loc => setUserLocation(loc.coords))
        .finally(() => setLocLoading(false));
    });
  }, []);

  const now     = new Date();
  const dateStr = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}`;

  // Count per filter for badges
  const filterCounts = {};
  FILTERS.forEach(f => {
    filterCounts[f.id] = events.filter(e => matchesFilter(e, f.id)).length;
  });

  const featured = events.filter(e => e.featured && matchesFilter(e, filter));

  let allEvents = events.filter(e => {
    if (!matchesFilter(e, filter)) return false;
    if (category && e.category !== category) return false;
    if (onlyFree && e.price !== 'Gratuit') return false;
    // Locurile mereu deschise apar separat în stripul "Deschis Acum"
    if (!category && !search && e.dateISO === null) return false;
    if (search && !e.title.toLowerCase().includes(search.toLowerCase()) &&
        !e.venue.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Attach real distance to events when location is available
  if (userLocation) {
    allEvents = allEvents.map(e => ({
      ...e,
      distance: formatDistance(
        getDistanceKm(userLocation.latitude, userLocation.longitude, e.lat, e.lng)
      ),
    }));
  }

  // Sort by distance
  if (sortByDist && userLocation) {
    allEvents = [...allEvents].sort((a, b) => {
      const dA = getDistanceKm(userLocation.latitude, userLocation.longitude, a.lat, a.lng);
      const dB = getDistanceKm(userLocation.latitude, userLocation.longitude, b.lat, b.lng);
      return dA - dB;
    });
  }

  const filterLabel = FILTER_LABELS[filter] || '';

  const openNowEvents = events.filter(e => {
    if (e.dateISO !== null) return false;
    if (openNowCat && e.category !== openNowCat) return false;
    return true;
  }).map(e => userLocation
    ? { ...e, distance: formatDistance(getDistanceKm(userLocation.latitude, userLocation.longitude, e.lat, e.lng)) }
    : e
  );

  const tonightEvents = !search && !category ? getTonightEvents(events, userLocation) : [];
  const nearbyEvents  = !search && !category ? getNearbyEvents(events, userLocation) : [];

  // Secțiunea „Pentru tine" — events din categoriile preferate la onboarding
  const forYouEvents = prefCats.length > 0 && !search && !category
    ? events
        .filter(e => prefCats.includes(e.category) && matchesFilter(e, filter))
        .slice(0, 6)
    : [];

  const toggleSort = () => {
    if (!userLocation && !locLoading) {
      // Try to get location again
      setLocLoading(true);
      Location.requestForegroundPermissionsAsync().then(({ status }) => {
        if (status !== 'granted') { setLocLoading(false); return; }
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          .then(loc => { setUserLocation(loc.coords); setSortByDist(true); })
          .finally(() => setLocLoading(false));
      });
    } else if (userLocation) {
      setSortByDist(prev => !prev);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      {/* Header */}
      <View style={styles.headerWrap}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Image source={LOGO} style={styles.logoImg} resizeMode="contain" />
          <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.sortBtn, sortByDist && styles.sortBtnActive]}
            onPress={toggleSort}
            activeOpacity={0.8}
          >
            {locLoading
              ? <ActivityIndicator size="small" color={COLORS.accent} style={{ width: 20 }} />
              : <Text style={[styles.sortBtnText, sortByDist && styles.sortBtnTextActive]}>
                  {sortByDist ? '📍 Aproape' : '◎ Aproape'}
                </Text>
            }
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.searchBtn, searchActive && styles.searchBtnActive]}
            onPress={() => { setSearchActive(!searchActive); if (searchActive) setSearch(''); }}
          >
            <Text style={styles.searchIcon}>{searchActive ? '✕' : '🔍'}</Text>
          </TouchableOpacity>
        </View>
        </View>
      </View>

      {/* Search bar */}
      {searchActive && (
        <View style={styles.searchBar}>
          <Text style={styles.searchBarIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Caută evenimente, locuri, taguri..."
            placeholderTextColor={COLORS.textMuted}
            value={search}
            onChangeText={setSearch}
            autoFocus
            selectionColor={COLORS.accent}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Text style={styles.clearBtn}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>

        {/* Greeting */}
        {!searchActive && (
          <View style={styles.greeting}>
            <Text style={styles.greetingText}>{getGreeting()}, București</Text>
            <Text style={styles.dateText}>{dateStr}</Text>
            {userLocation && sortByDist && (
              <Text style={styles.locationHint}>📍 Sortate după distanța față de tine</Text>
            )}
          </View>
        )}

        {/* City Pulse Banner */}
        {heatData.length > 0 && !searchActive && (
          <TouchableOpacity
            style={styles.pulseBanner}
            onPress={() => navigation.navigate('CityPulse')}
            activeOpacity={0.88}
          >
            <Text style={styles.pulseBannerIcon}>🔥</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.pulseBannerTitle}>City Pulse</Text>
              <Text style={styles.pulseBannerSub}>
                {heatData.filter(v => v.heat_level === 'packed' || v.heat_level === 'busy').length} locuri active acum în București
              </Text>
            </View>
            <Text style={styles.pulseBannerArrow}>›</Text>
          </TouchableOpacity>
        )}

        {/* Diseară în București */}
        {tonightEvents.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>🌙 DISEARĂ ÎN BUCUREȘTI</Text>
              <Text style={styles.openNowCount}>încep în &lt;3h</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.featuredScroll}
            >
              {tonightEvents.map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  featured
                  onPress={() => navigation.navigate('EventDetail', { event: e })}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Lângă tine */}
        {nearbyEvents.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>📍 LÂNGĂ TINE — &lt;2KM</Text>
              <Text style={styles.openNowCount}>{nearbyEvents.length} locuri</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.featuredScroll}
            >
              {nearbyEvents.map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  featured
                  onPress={() => navigation.navigate('EventDetail', { event: e })}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Filter tabs with counts */}
        <View style={styles.section}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {FILTERS.map(f => {
              const isActive = filter === f.id;
              const count = filterCounts[f.id];
              return (
                <TouchableOpacity
                  key={f.id}
                  style={[styles.filterTab, isActive && styles.filterTabActive]}
                  onPress={() => { setFilter(f.id); setCategory(null); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.filterLabel, isActive && styles.filterLabelActive]}>
                    {f.label}
                  </Text>
                  <View style={[styles.filterCount, isActive && styles.filterCountActive]}>
                    <Text style={[styles.filterCountText, isActive && styles.filterCountTextActive]}>
                      {count}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            {/* Gratuit chip */}
            <TouchableOpacity
              style={[styles.filterTab, onlyFree && styles.freeTabActive]}
              onPress={() => setOnlyFree(prev => !prev)}
              activeOpacity={0.8}
            >
              <Text style={[styles.filterLabel, onlyFree && styles.freeLabelActive]}>
                ✓ Gratuit
              </Text>
              <View style={[styles.filterCount, onlyFree && styles.freeCountActive]}>
                <Text style={[styles.filterCountText, onlyFree && styles.freeCountTextActive]}>
                  {events.filter(e => e.price === 'Gratuit').length}
                </Text>
              </View>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* Categories */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel}>CATEGORII</Text>
            {category && (
              <TouchableOpacity onPress={() => setCategory(null)}>
                <Text style={styles.clearCat}>✕ Toate</Text>
              </TouchableOpacity>
            )}
          </View>
          <CategoryGrid selected={category} onSelect={setCategory} filter={filter} />
        </View>

        {/* Pentru tine — personalizat din onboarding */}
        {forYouEvents.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>⚡ PENTRU TINE</Text>
              <Text style={styles.clearCat}>{prefCats.length} categ.</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.featuredScroll}
            >
              {forYouEvents.map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  featured
                  onPress={() => navigation.navigate('EventDetail', { event: e })}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Featured */}
        {!category && !search && (loading || featured.length > 0) && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>🔥 RECOMANDATE — {filterLabel.toUpperCase()}</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.featuredScroll}
            >
              {loading
                ? [1, 2, 3].map(i => <SkeletonFeaturedCard key={i} />)
                : featured.map(e => {
                    const enriched = userLocation
                      ? { ...e, distance: formatDistance(getDistanceKm(userLocation.latitude, userLocation.longitude, e.lat, e.lng)) }
                      : e;
                    return (
                      <EventCard
                        key={e.id}
                        event={enriched}
                        featured
                        onPress={() => navigation.navigate('EventDetail', { event: enriched })}
                      />
                    );
                  })
              }
            </ScrollView>
          </View>
        )}

        {/* Deschis Acum — locuri permanente cu sub-filtru categorie */}
        {!category && !search && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>📍 DESCHIS ACUM</Text>
              <Text style={styles.openNowCount}>{openNowEvents.length} locuri</Text>
            </View>
            {/* Category sub-filters */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.openNowFilterScroll}
              contentContainerStyle={styles.openNowFilterRow}
            >
              {OPEN_NOW_CATS.map(c => {
                const count = events.filter(e => e.dateISO === null && (c.id ? e.category === c.id : true)).length;
                if (count === 0 && c.id !== null) return null;
                const active = openNowCat === c.id;
                return (
                  <TouchableOpacity
                    key={String(c.id)}
                    style={[styles.openNowChip, active && styles.openNowChipActive]}
                    onPress={() => setOpenNowCat(active ? null : c.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.openNowChipIcon}>{c.icon}</Text>
                    <Text style={[styles.openNowChipText, active && styles.openNowChipTextActive]}>
                      {c.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.featuredScroll}
            >
              {openNowEvents.map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  featured
                  onPress={() => navigation.navigate('EventDetail', { event: e })}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* All events list */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel}>
              {search
                ? `${allEvents.length} REZULTATE PENTRU „${search.toUpperCase()}"`
                : category
                ? `${allEvents.length} REZULTATE`
                : `EVENTS — ${filterLabel.toUpperCase()} (${allEvents.length})`}
            </Text>
            {sortByDist && userLocation && (
              <Text style={styles.sortIndicator}>↑ DISTANȚĂ</Text>
            )}
          </View>
          <View style={styles.listContainer}>
            {loading ? (
              [1, 2, 3, 4, 5].map(i => <SkeletonListCard key={i} />)
            ) : allEvents.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>
                  {search ? '🔍' : category ? '📂' : '📅'}
                </Text>
                <Text style={styles.emptyTitle}>
                  {search
                    ? 'Niciun rezultat'
                    : category
                    ? 'Nicio locație în această categorie'
                    : `Nimic programat ${filterLabel.toLowerCase()}`}
                </Text>
                <Text style={styles.emptyText}>
                  {search
                    ? 'Încearcă alt termen de căutare'
                    : category
                    ? 'Schimbă filtrul de dată sau selectează altă categorie'
                    : 'Încearcă să schimbi filtrul de timp'}
                </Text>
                {(category || search) && (
                  <TouchableOpacity
                    style={styles.emptyBtn}
                    onPress={() => { setCategory(null); setSearch(''); setSearchActive(false); }}
                  >
                    <Text style={styles.emptyBtnText}>Resetează filtrele</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              allEvents.map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  onPress={() => navigation.navigate('EventDetail', { event: e })}
                />
              ))
            )}
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Floating Magic Button */}
      <View style={styles.magicBtnWrap} pointerEvents="box-none">
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity style={styles.magicBtn} onPress={showMagic} activeOpacity={0.88}>
            <Text style={styles.magicBtnIcon}>✨</Text>
            <Text style={styles.magicBtnText}>Ce fac azi?</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* Magic Modal — bottom sheet */}
      <Modal
        visible={magicVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMagicVisible(false)}
      >
        <TouchableOpacity
          style={styles.magicOverlay}
          activeOpacity={1}
          onPress={() => setMagicVisible(false)}
        />
        <View style={styles.magicSheet}>
          <View style={styles.magicHeader}>
            <View>
              <Text style={styles.magicTitle}>✨ Ce fac azi?</Text>
              <Text style={styles.magicSubtitle}>3 sugestii curate pentru tine</Text>
            </View>
            <TouchableOpacity style={styles.magicCloseBtn} onPress={() => setMagicVisible(false)}>
              <Text style={styles.magicCloseBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {magicPicks.map(event => (
            <TouchableOpacity
              key={event.id}
              style={styles.magicCard}
              onPress={() => { setMagicVisible(false); navigation.navigate('EventDetail', { event }); }}
              activeOpacity={0.85}
            >
              <Image source={{ uri: event.image }} style={styles.magicCardImg} />
              <View style={styles.magicCardInfo}>
                <Text style={styles.magicCardCat}>{CAT_ICONS[event.category]} {event.categoryLabel}</Text>
                <Text style={styles.magicCardTitle} numberOfLines={1}>{event.title}</Text>
                <Text style={styles.magicCardVenue} numberOfLines={1}>📍 {event.venue}</Text>
                <View style={styles.magicCardRow}>
                  {event.time ? <Text style={styles.magicCardTime}>⏰ {event.time}</Text> : null}
                  <View style={[styles.magicPriceBadge, event.price === 'Gratuit' && styles.magicPriceFree]}>
                    <Text style={[styles.magicPriceText, event.price === 'Gratuit' && styles.magicPriceFreeText]}>
                      {event.price}
                    </Text>
                  </View>
                </View>
              </View>
              <Text style={styles.magicCardArrow}>›</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={styles.magicShuffleBtn}
            onPress={() => setMagicPicks(getMagicSuggestions(events, userLocation))}
            activeOpacity={0.85}
          >
            <Text style={styles.magicShuffleBtnText}>🔀  Alte sugestii</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },

  headerWrap: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  headerSpacer: { flex: 1 },
  logoImg: { width: 110, height: 38, borderRadius: 0 },
  headerRight: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'flex-end' },

  sortBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  sortBtnActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft },
  sortBtnText: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary },
  sortBtnTextActive: { color: COLORS.accent },

  searchBtn: { padding: 8, borderRadius: 20 },
  searchBtnActive: { backgroundColor: COLORS.surface },
  searchIcon: { fontSize: 18 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.accentMid,
    paddingHorizontal: 14,
    height: 48,
  },
  searchBarIcon: { fontSize: 15, marginRight: 8 },
  searchInput: { flex: 1, color: COLORS.textPrimary, fontSize: 14 },
  clearBtn: { color: COLORS.textMuted, fontSize: 16, padding: 4 },

  greeting: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4 },
  greetingText: { fontSize: 13, color: COLORS.textSecondary, letterSpacing: 0.3 },
  dateText: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary, marginTop: 2 },
  locationHint: { fontSize: 11, color: COLORS.accent, marginTop: 4, fontWeight: '600' },

  section: { marginTop: 20 },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.2 },
  clearCat: { fontSize: 11, color: COLORS.accent, fontWeight: '600' },
  sortIndicator: { fontSize: 9, fontWeight: '700', color: COLORS.accent, letterSpacing: 1 },

  filterRow: { paddingHorizontal: 16, gap: 8, flexDirection: 'row' },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    marginRight: 8,
  },
  filterTabActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  filterLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
  filterLabelActive: { color: '#fff' },
  filterCount: {
    backgroundColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: 'center',
  },
  filterCountActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  filterCountText: { fontSize: 10, fontWeight: '700', color: COLORS.textMuted },
  filterCountTextActive: { color: '#fff' },
  freeTabActive: { backgroundColor: '#14532D', borderColor: '#22C55E' },
  freeLabelActive: { color: '#22C55E' },
  freeCountActive: { backgroundColor: 'rgba(34,197,94,0.25)' },
  freeCountTextActive: { color: '#22C55E' },

  openNowCount: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  openNowFilterScroll: { flexGrow: 0 },
  openNowFilterRow: { paddingHorizontal: 20, gap: 6, flexDirection: 'row', paddingBottom: 12, alignItems: 'center' },
  openNowChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    marginRight: 2,
  },
  openNowChipActive: { backgroundColor: 'rgba(255,115,52,0.14)', borderColor: COLORS.accent },
  openNowChipIcon: { fontSize: 13 },
  openNowChipText: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary },
  openNowChipTextActive: { color: COLORS.accent },

  featuredScroll: { paddingHorizontal: 20 },
  listContainer: { paddingHorizontal: 16 },

  empty: { alignItems: 'center', paddingVertical: 50, paddingHorizontal: 20 },
  emptyIcon: { fontSize: 44, marginBottom: 14 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 8, textAlign: 'center' },
  emptyText: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: COLORS.accentSoft,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.accentMid,
  },
  emptyBtnText: { fontSize: 13, fontWeight: '600', color: COLORS.accent },

  // City Pulse Banner
  pulseBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
  },
  pulseBannerIcon:  { fontSize: 24 },
  pulseBannerTitle: { fontSize: 13, fontWeight: '800', color: '#F7F4F0' },
  pulseBannerSub:   { fontSize: 11, color: '#EF4444', marginTop: 2, fontWeight: '600' },
  pulseBannerArrow: { fontSize: 22, color: 'rgba(239,68,68,0.7)', fontWeight: '300' },

  // Magic Button
  magicBtnWrap: {
    position: 'absolute',
    bottom: 22,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  magicBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.accent,
    borderRadius: 28,
    paddingHorizontal: 26,
    paddingVertical: 14,
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 14,
    elevation: 10,
  },
  magicBtnIcon: { fontSize: 18 },
  magicBtnText: { fontSize: 15, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },

  // Magic Modal
  magicOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  magicSheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  magicHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  magicTitle: { fontSize: 20, fontWeight: '900', color: COLORS.textPrimary },
  magicSubtitle: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  magicCloseBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  magicCloseBtnText: { fontSize: 14, color: COLORS.textMuted, fontWeight: '700' },

  magicCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  magicCardImg: { width: 66, height: 66, borderRadius: 10, backgroundColor: COLORS.border },
  magicCardInfo: { flex: 1, gap: 3 },
  magicCardCat: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  magicCardTitle: { fontSize: 14, fontWeight: '800', color: COLORS.textPrimary },
  magicCardVenue: { fontSize: 11, color: COLORS.textSecondary },
  magicCardRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  magicCardTime: { fontSize: 11, color: COLORS.textSecondary },
  magicPriceBadge: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8,
    backgroundColor: COLORS.border,
  },
  magicPriceFree: { backgroundColor: 'rgba(34,197,94,0.15)' },
  magicPriceText: { fontSize: 10, fontWeight: '700', color: COLORS.textSecondary },
  magicPriceFreeText: { color: '#22C55E' },
  magicCardArrow: { fontSize: 26, color: COLORS.accent, fontWeight: '300' },

  magicShuffleBtn: {
    marginTop: 4,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
  },
  magicShuffleBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
});
