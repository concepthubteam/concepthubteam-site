import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  ScrollView, TouchableOpacity, Image, Share, Alert,
} from 'react-native';
import { COLORS } from '../constants/colors';
import { useSaved } from '../context/SavedContext';
import { CATEGORIES } from '../data/mockData';
import EventCard from '../components/EventCard';
import { SkeletonListCard } from '../components/SkeletonCard';
import { useEvents } from '../context/EventsContext';
import {
  scheduleEventReminder,
  cancelAllReminders,
  getScheduledEventIds,
} from '../utils/notifications';

const LOGO = require('../../assets/logo.png');

const SORT_OPTIONS = [
  { id: 'date',     label: 'Dată' },
  { id: 'rating',   label: 'Rating' },
  { id: 'distance', label: 'Distanță' },
];

export default function SavedScreen({ navigation }) {
  const { events } = useEvents();
  const { savedIds, toggleSaved, loaded } = useSaved();
  const [sort, setSort]               = useState('date');
  const [groupBy, setGroupBy]         = useState(false);
  const [reminderIds, setReminderIds] = useState(new Set());

  useEffect(() => {
    getScheduledEventIds().then(ids => setReminderIds(ids));
  }, []);

  const scheduleAllReminders = async () => {
    const eventsWithDate = savedEvents.filter(e => e.dateISO);
    if (eventsWithDate.length === 0) {
      Alert.alert('Niciun eveniment cu dată', 'Evenimentele mereu deschise nu au reminder de timp.');
      return;
    }
    let count = 0;
    for (const e of eventsWithDate) {
      const id = await scheduleEventReminder(e);
      if (id) count++;
    }
    const newIds = await getScheduledEventIds();
    setReminderIds(newIds);
    Alert.alert('Remindere setate 🔔', `${count} remindere activate pentru evenimentele cu dată.`);
  };

  const clearAllReminders = async () => {
    await cancelAllReminders();
    setReminderIds(new Set());
    Alert.alert('Remindere șterse', 'Toate reminderele GOZI au fost anulate.');
  };

  const shareList = async (events) => {
    const lines = events.map((e, i) =>
      `${i + 1}. ${e.title} — ${e.date} @ ${e.venue} (${e.price})`
    ).join('\n');
    await Share.share({
      message: `Lista mea de events pe GOZI:\n\n${lines}\n\n📱 Descarcă GOZI!`,
      title: 'Lista mea GOZI',
    });
  };

  const savedEvents = events
    .filter(e => savedIds.has(e.id))
    .sort((a, b) => {
      if (sort === 'rating')   return b.rating - a.rating;
      if (sort === 'distance') return parseFloat(a.distance) - parseFloat(b.distance);
      // date sort: null dateISO (always open) go last
      if (!a.dateISO && !b.dateISO) return 0;
      if (!a.dateISO) return 1;
      if (!b.dateISO) return -1;
      return a.dateISO.localeCompare(b.dateISO);
    });

  // Loading skeleton while AsyncStorage restores saved IDs
  if (!loaded) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Image source={LOGO} style={styles.logoImg} resizeMode="contain" />
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.skeletonList}>
          {[1, 2, 3, 4, 5].map(i => <SkeletonListCard key={i} />)}
        </View>
      </SafeAreaView>
    );
  }

  if (savedEvents.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Image source={LOGO} style={styles.logoImg} resizeMode="contain" />
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.empty}>
          {/* Illustration card */}
          <View style={styles.emptyIllustration}>
            <Text style={styles.emptyBigEmoji}>🗺️</Text>
            <View style={styles.emptyHeartBubble}>
              <Text style={styles.emptyHeartText}>♡</Text>
            </View>
          </View>

          <Text style={styles.emptyTitle}>Lista ta e goală</Text>
          <Text style={styles.emptyText}>
            Salvează locuri și evenimente preferate apăsând{' '}
            <Text style={{ color: COLORS.accent }}>♡</Text> pe orice card.
          </Text>

          {/* Hint chips */}
          <View style={styles.emptyHints}>
            {['🍽️ Restaurante', '🎶 Cluburi', '🎉 Evenimente'].map(hint => (
              <View key={hint} style={styles.emptyHintChip}>
                <Text style={styles.emptyHintText}>{hint}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={styles.emptyBtn}
            onPress={() => navigation.navigate('Home')}
            activeOpacity={0.85}
          >
            <Text style={styles.emptyBtnText}>✨  Explorează acum</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Group by category
  const groups = CATEGORIES
    .map(cat => ({
      ...cat,
      events: savedEvents.filter(e => e.category === cat.id),
    }))
    .filter(g => g.events.length > 0);

  const freeCount = savedEvents.filter(e => e.price === 'Gratuit').length;
  const avgRating = (savedEvents.reduce((s, e) => s + e.rating, 0) / savedEvents.length).toFixed(1);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <Image source={LOGO} style={styles.logoImg} resizeMode="contain" />
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.shareBtn}
            onPress={() => shareList(savedEvents)}
            activeOpacity={0.8}
          >
            <Text style={styles.shareBtnText}>↗ Share</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats mini */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{savedEvents.length}</Text>
          <Text style={styles.statLabel}>TOTAL</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{freeCount}</Text>
          <Text style={styles.statLabel}>GRATUIT</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>★ {avgRating}</Text>
          <Text style={styles.statLabel}>RATING MED.</Text>
        </View>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <View style={styles.sortRow}>
          {SORT_OPTIONS.map(s => (
            <TouchableOpacity
              key={s.id}
              style={[styles.sortChip, sort === s.id && styles.sortChipActive]}
              onPress={() => setSort(s.id)}
            >
              <Text style={[styles.sortChipText, sort === s.id && styles.sortChipTextActive]}>
                {s.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={[styles.groupBtn, groupBy && styles.groupBtnActive]}
          onPress={() => setGroupBy(!groupBy)}
        >
          <Text style={[styles.groupBtnText, groupBy && styles.groupBtnTextActive]}>
            {groupBy ? '≡ Listă' : '⊞ Grup'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Reminder banner */}
      <View style={styles.reminderBanner}>
        <View style={styles.reminderLeft}>
          <Text style={styles.reminderIcon}>🔔</Text>
          <View>
            <Text style={styles.reminderTitle}>Remindere</Text>
            <Text style={styles.reminderSub}>
              {reminderIds.size > 0 ? `${reminderIds.size} active` : 'Niciunul activ'}
            </Text>
          </View>
        </View>
        <View style={styles.reminderBtns}>
          <TouchableOpacity style={styles.reminderBtn} onPress={scheduleAllReminders} activeOpacity={0.8}>
            <Text style={styles.reminderBtnText}>+ Toate</Text>
          </TouchableOpacity>
          {reminderIds.size > 0 && (
            <TouchableOpacity style={[styles.reminderBtn, styles.reminderBtnCancel]} onPress={clearAllReminders} activeOpacity={0.8}>
              <Text style={[styles.reminderBtnText, { color: COLORS.textMuted }]}>✕ Șterge</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {groupBy ? (
          /* Grouped view */
          groups.map(group => (
            <View key={group.id} style={styles.group}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupIcon}>{group.icon}</Text>
                <Text style={[styles.groupLabel, { color: group.color }]}>
                  {group.label.toUpperCase()}
                </Text>
                <Text style={styles.groupCount}>{group.events.length}</Text>
              </View>
              {group.events.map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  onPress={() => navigation.navigate('EventDetail', { event: e })}
                />
              ))}
            </View>
          ))
        ) : (
          /* Flat list */
          savedEvents.map(e => (
            <EventCard
              key={e.id}
              event={e}
              onPress={() => navigation.navigate('EventDetail', { event: e })}
            />
          ))
        )}
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  headerSpacer: { flex: 1 },
  logoImg: { width: 110, height: 38, borderRadius: 0 },
  headerRight: { flex: 1, alignItems: 'flex-end' },
  shareBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  shareBtnText: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary },

  statsRow: {
    flexDirection: 'row',
    paddingVertical: 16,
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800', color: COLORS.accent, marginBottom: 3 },
  statLabel: { fontSize: 9, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1 },
  statDivider: { width: 1, backgroundColor: COLORS.border },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  sortRow: { flex: 1, flexDirection: 'row', gap: 6 },
  sortChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  sortChipActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft },
  sortChipText: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary },
  sortChipTextActive: { color: COLORS.accent },

  groupBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  groupBtnActive: { borderColor: COLORS.accentMid, backgroundColor: COLORS.accentSoft },
  groupBtnText: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary },
  groupBtnTextActive: { color: COLORS.accent },

  list: { flex: 1, paddingHorizontal: 16 },
  skeletonList: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },

  group: { marginBottom: 8 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  groupIcon: { fontSize: 16 },
  groupLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, flex: 1 },
  groupCount: {
    fontSize: 11,
    color: COLORS.textMuted,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    fontWeight: '600',
  },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyIllustration: {
    width: 120, height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
    position: 'relative',
  },
  emptyBigEmoji: { fontSize: 54 },
  emptyHeartBubble: {
    position: 'absolute', bottom: 4, right: 4,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: COLORS.accent,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: COLORS.bg,
  },
  emptyHeartText: { fontSize: 16, color: '#fff' },

  emptyTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 10 },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  emptyHints: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 8, justifyContent: 'center',
    marginBottom: 28,
  },
  emptyHintChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: COLORS.surface,
    borderRadius: 20, borderWidth: 1, borderColor: COLORS.border,
  },
  emptyHintText: { fontSize: 13, color: COLORS.textSecondary, fontWeight: '600' },

  emptyBtn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    backgroundColor: COLORS.accent,
    borderRadius: 22,
  },
  emptyBtnText: { fontSize: 15, fontWeight: '800', color: '#000' },

  reminderBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.25)',
  },
  reminderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reminderIcon: { fontSize: 22 },
  reminderTitle: { fontSize: 12, fontWeight: '700', color: COLORS.textPrimary },
  reminderSub: { fontSize: 10, color: COLORS.textMuted, marginTop: 1 },
  reminderBtns: { flexDirection: 'row', gap: 6 },
  reminderBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
  },
  reminderBtnCancel: {
    backgroundColor: COLORS.surfaceAlt,
    borderColor: COLORS.border,
  },
  reminderBtnText: { fontSize: 11, fontWeight: '700', color: '#F59E0B' },
});
