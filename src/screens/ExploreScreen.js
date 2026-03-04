import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, StatusBar, TextInput, Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../constants/colors';
import { CATEGORIES } from '../data/mockData';
import EventCard from '../components/EventCard';
import { HISTORY_KEY } from './EventDetailScreen';
import { useEvents } from '../context/EventsContext';

const LOGO = require('../../assets/logo.png');

function getCategoryIcon(category) {
  const icons = {
    events: '🎉', restaurants: '🍽️', clubs: '🎶',
    kids: '👶', parks: '🌳', cinema: '🎬',
    sport: '🏋️', theatre: '🎭',
  };
  return icons[category] || '📍';
}

export default function ExploreScreen({ navigation }) {
  const { events } = useEvents();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const [activeTag, setActiveTag] = useState(null);
  const [recentIds, setRecentIds] = useState([]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      AsyncStorage.getItem(HISTORY_KEY).then(raw => {
        if (raw) {
          try { setRecentIds(JSON.parse(raw).slice(0, 6)); } catch (_) {}
        }
      });
    });
    return unsubscribe;
  }, [navigation]);

  // ALL_TAGS computed from live events (moved inside component for dynamic data)
  const ALL_TAGS = (() => {
    const counts = {};
    events.forEach(e => e.tags.forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag]) => tag);
  })();

  const recentEvents = recentIds
    .map(id => events.find(e => e.id === id))
    .filter(Boolean);

  const searchResults = search.length > 1
    ? events.filter(e =>
        e.title.toLowerCase().includes(search.toLowerCase()) ||
        e.venue.toLowerCase().includes(search.toLowerCase()) ||
        e.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
      )
    : activeTag
    ? events.filter(e => e.tags.includes(activeTag))
    : [];

  const showSearchResults = search.length > 1 || activeTag;

  const categoryEvents = activeCategory
    ? events.filter(e => e.category === activeCategory)
    : null;

  const topByCategory = CATEGORIES.map(cat => ({
    ...cat,
    events: events.filter(e => e.category === cat.id).slice(0, 3),
  })).filter(cat => cat.events.length > 0);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <View style={styles.headerWrap}>
        <View style={styles.header}>
          <Image source={LOGO} style={styles.logoImg} resizeMode="contain" />
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Caută orice eveniment, loc, tag..."
          placeholderTextColor={COLORS.textMuted}
          value={search}
          onChangeText={t => { setSearch(t); if (t.length > 0) setActiveTag(null); }}
          selectionColor={COLORS.accent}
        />
        {(search.length > 0 || activeTag) && (
          <TouchableOpacity onPress={() => { setSearch(''); setActiveTag(null); }}>
            <Text style={styles.clearBtn}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Search results */}
      {showSearchResults ? (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.searchResultsHeader}>
            {activeTag && (
              <View style={styles.activeTagChip}>
                <Text style={styles.activeTagText}>#{activeTag}</Text>
                <TouchableOpacity onPress={() => setActiveTag(null)}>
                  <Text style={styles.activeTagClose}>✕</Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={styles.sectionLabel}>
              {searchResults.length} REZULTATE
              {search.length > 1 ? ` PENTRU „${search.toUpperCase()}"` : ''}
            </Text>
          </View>
          {searchResults.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTitle}>Nicio locație găsită</Text>
              <Text style={styles.emptyText}>Încearcă un alt termen de căutare</Text>
            </View>
          ) : (
            <View style={styles.listPad}>
              {searchResults.map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  onPress={() => navigation.navigate('EventDetail', { event: e })}
                />
              ))}
            </View>
          )}
          <View style={{ height: 100 }} />
        </ScrollView>
      ) : activeCategory ? (
        /* Category drill-down */
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {(() => {
            const cat = CATEGORIES.find(c => c.id === activeCategory);
            return (
              <>
                <View style={styles.catDrillHero}>
                  {cat?.image && (
                    <Image
                      source={{ uri: cat.image }}
                      style={StyleSheet.absoluteFillObject}
                      resizeMode="cover"
                    />
                  )}
                  <LinearGradient
                    colors={['rgba(0,0,0,0.15)', `${cat?.color}EE`]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <TouchableOpacity style={styles.backChip} onPress={() => setActiveCategory(null)}>
                    <Text style={styles.backChipText}>← Înapoi</Text>
                  </TouchableOpacity>
                  <View style={styles.catDrillBottom}>
                    <Text style={styles.catDrillLabel}>{cat?.label.toUpperCase()}</Text>
                    <Text style={styles.catDrillCount}>{categoryEvents.length} locații</Text>
                  </View>
                </View>
                <View style={styles.listPad}>
                  {categoryEvents.map(e => (
                    <EventCard
                      key={e.id}
                      event={e}
                      onPress={() => navigation.navigate('EventDetail', { event: e })}
                    />
                  ))}
                </View>
                <View style={{ height: 100 }} />
              </>
            );
          })()}
        </ScrollView>
      ) : (
        /* Default: category grid + top picks */
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Recent vizitate */}
          {recentEvents.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <View style={styles.sectionHeadLeft}>
                  <Text style={styles.sectionHeadEmoji}>🕐</Text>
                  <Text style={[styles.sectionHeadLabel, { color: COLORS.textSecondary }]}>VIZITATE RECENT</Text>
                </View>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16 }}
              >
                {recentEvents.map(e => (
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

          {/* Popular tags cloud */}
          <Text style={[styles.sectionLabel, { paddingHorizontal: 20, paddingTop: 20 }]}>
            🏷️ TAGURI POPULARE
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tagsRow}
          >
            {ALL_TAGS.map(tag => (
              <TouchableOpacity
                key={tag}
                style={[styles.tagChip, activeTag === tag && styles.tagChipActive]}
                onPress={() => { setActiveTag(activeTag === tag ? null : tag); setSearch(''); }}
                activeOpacity={0.8}
              >
                <Text style={[styles.tagText, activeTag === tag && styles.tagTextActive]}>
                  #{tag}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Category pills — big tappable */}
          <View style={styles.catGridHeader}>
            <Text style={styles.sectionLabel}>CATEGORII</Text>
          </View>
          <View style={styles.catGrid}>
            {CATEGORIES.map((cat, idx) => {
              const count = events.filter(e => e.category === cat.id).length;
              const isWide = CATEGORIES.length % 2 !== 0 && idx === CATEGORIES.length - 1;
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.catCard, isWide && styles.catCardWide]}
                  onPress={() => setActiveCategory(cat.id)}
                  activeOpacity={0.8}
                >
                  {cat.image && (
                    <Image
                      source={{ uri: cat.image }}
                      style={StyleSheet.absoluteFillObject}
                      resizeMode="cover"
                    />
                  )}
                  <LinearGradient
                    colors={['rgba(0,0,0,0.1)', `${cat.color}E0`]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <View style={styles.catCardContent}>
                    <Text style={styles.catCardIcon}>{cat.icon}</Text>
                    <Text style={styles.catCardLabel}>{cat.label}</Text>
                    <Text style={styles.catCardCount}>{count} locații</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Trending — highest rated */}
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <View style={styles.sectionHeadLeft}>
                <View style={styles.trendingBadge}>
                  <Text style={styles.trendingBadgeText}>🔥 TRENDING</Text>
                </View>
                <Text style={[styles.sectionHeadLabel, { color: COLORS.accent }]}>ÎN BUCUREȘTI</Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16 }}
            >
              {[...events]
                .sort((a, b) => b.rating - a.rating)
                .slice(0, 6)
                .map(e => (
                  <EventCard
                    key={e.id}
                    event={e}
                    featured
                    onPress={() => navigation.navigate('EventDetail', { event: e })}
                  />
                ))}
            </ScrollView>
          </View>

          {/* Free events — horizontal strip */}
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <View style={styles.sectionHeadLeft}>
                <View style={[styles.trendingBadge, styles.freeBadge]}>
                  <Text style={[styles.trendingBadgeText, { color: '#22C55E' }]}>✓ GRATUIT</Text>
                </View>
                <Text style={[styles.sectionHeadLabel, { color: '#22C55E' }]}>
                  {events.filter(e => e.price === 'Gratuit').length} intrări free
                </Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16 }}
            >
              {events.filter(e => e.price === 'Gratuit').map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  featured
                  onPress={() => navigation.navigate('EventDetail', { event: e })}
                />
              ))}
            </ScrollView>
          </View>

          {/* Top per category */}
          {topByCategory.map(cat => (
            <View key={cat.id} style={styles.section}>
              <View style={styles.sectionHead}>
                <View style={styles.sectionHeadLeft}>
                  <Text style={styles.sectionHeadEmoji}>{cat.icon}</Text>
                  <Text style={[styles.sectionHeadLabel, { color: cat.color }]}>
                    {cat.label.toUpperCase()}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setActiveCategory(cat.id)}>
                  <Text style={[styles.seeAll, { color: cat.color }]}>
                    Vezi toate →
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.listPad}>
                {cat.events.map(e => (
                  <EventCard
                    key={e.id}
                    event={e}
                    onPress={() => navigation.navigate('EventDetail', { event: e })}
                  />
                ))}
              </View>
            </View>
          ))}

          <View style={{ height: 100 }} />
        </ScrollView>
      )}
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  logoImg: { width: 110, height: 38, borderRadius: 0 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    height: 48,
  },
  searchIcon: { fontSize: 16, marginRight: 10 },
  searchInput: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 14,
    height: '100%',
  },
  clearBtn: { fontSize: 14, color: COLORS.textMuted, padding: 4 },

  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1.5,
    paddingVertical: 12,
  },

  tagsRow: { paddingHorizontal: 16, gap: 8, flexDirection: 'row', paddingBottom: 4 },
  tagChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    marginRight: 4,
  },
  tagChipActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft },
  tagText: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary },
  tagTextActive: { color: COLORS.accent },

  searchResultsHeader: { paddingHorizontal: 20, paddingTop: 12 },
  activeTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.accentMid,
    backgroundColor: COLORS.accentSoft,
    marginBottom: 8,
  },
  activeTagText: { fontSize: 12, fontWeight: '700', color: COLORS.accent },
  activeTagClose: { fontSize: 12, color: COLORS.accent },

  catGridHeader: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 0 },
  catGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 8,
    paddingBottom: 8,
  },
  catCard: {
    width: '47%',
    height: 106,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: 18,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  catCardWide: { width: '97%' },
  catCardContent: { padding: 14 },
  catCardIcon: { fontSize: 22, marginBottom: 4 },
  catCardLabel: { fontSize: 14, fontWeight: '800', color: '#fff', marginBottom: 3, letterSpacing: 0.2 },
  catCardCount: { fontSize: 11, color: 'rgba(255,255,255,0.72)', fontWeight: '600' },

  section: { marginTop: 8 },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 10,
    paddingTop: 16,
  },
  sectionHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionHeadEmoji: { fontSize: 16 },
  sectionHeadLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  seeAll: { fontSize: 11, fontWeight: '600' },
  trendingBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255,115,52,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,115,52,0.35)',
  },
  trendingBadgeText: { fontSize: 10, fontWeight: '800', color: COLORS.accent, letterSpacing: 0.5 },
  freeBadge: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderColor: 'rgba(34,197,94,0.3)',
  },

  listPad: { paddingHorizontal: 16 },

  catDrillHero: {
    height: 160,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: COLORS.surfaceAlt,
    justifyContent: 'space-between',
    padding: 16,
  },
  backChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  backChipText: { fontSize: 12, color: '#fff', fontWeight: '600' },
  catDrillBottom: { gap: 2 },
  catDrillLabel: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  catDrillCount: { fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },

  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 6 },
  emptyText: { fontSize: 13, color: COLORS.textSecondary },
});
