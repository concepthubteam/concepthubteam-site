import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../constants/colors';
import { useSaved } from '../context/SavedContext';

function getCategoryIcon(category) {
  const icons = {
    events: '🎉', restaurants: '🍽️', clubs: '🎶',
    kids: '👶', parks: '🌳', cinema: '🎬',
    sport: '🏋️', theatre: '🎭',
  };
  return icons[category] || '📍';
}

export default function EventCard({ event, onPress, featured = false }) {
  const { isSaved, toggleSaved } = useSaved();
  const saved = isSaved(event.id);
  const catColor = COLORS.cat[event.category] || COLORS.accent;
  const todayISO = new Date().toISOString().split('T')[0];
  const isToday = event.dateISO === todayISO;

  if (featured) {
    return (
      <TouchableOpacity style={styles.featuredCard} onPress={onPress} activeOpacity={0.85}>
        {/* Image area */}
        <View style={styles.featuredImage}>
          {event.image ? (
            <Image
              source={{ uri: event.image }}
              style={StyleSheet.absoluteFillObject}
              resizeMode="cover"
            />
          ) : (
            <LinearGradient
              colors={[`${catColor}55`, `${catColor}11`, COLORS.surfaceAlt]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          )}
          {/* Dark gradient overlay for readability */}
          <LinearGradient
            colors={['rgba(0,0,0,0.08)', 'rgba(0,0,0,0.55)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          {/* Category icon — only shown without real image */}
          {!event.image && (
            <Text style={styles.featuredImageIcon}>
              {getCategoryIcon(event.category)}
            </Text>
          )}
          <View style={[styles.catBadge, { backgroundColor: catColor }]}>
            <Text style={styles.catBadgeText}>{(event.categoryLabel || event.category || '').toUpperCase()}</Text>
          </View>
          {event.price === 'Gratuit' && (
            <View style={styles.freeBadge}>
              <Text style={styles.freeBadgeText}>GRATUIT</Text>
            </View>
          )}
          {isToday && (
            <View style={styles.todayBadge}>
              <Text style={styles.todayBadgeText}>AZI</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.featuredSaveBtn}
            onPress={(e) => { e.stopPropagation?.(); toggleSaved(event.id); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.featuredSaveIcon, saved && { color: COLORS.accent }]}>
              {saved ? '♥' : '♡'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Info */}
        <View style={styles.featuredInfo}>
          <Text style={styles.featuredTitle} numberOfLines={1}>{event.title}</Text>
          <Text style={styles.featuredDate}>{event.date}</Text>
          <View style={styles.featuredMeta}>
            <Text style={styles.metaText}>⏰ {event.time}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText} numberOfLines={1}>📍 {event.venue}</Text>
          </View>
          <View style={styles.featuredBottom}>
            <Text style={styles.ratingText}>★ {event.rating}</Text>
            <Text style={styles.distanceText}>{event.distance}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  // List card (compact)
  return (
    <TouchableOpacity style={styles.listCard} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.listAccent, { backgroundColor: catColor }]} />
      {/* Thumbnail — real image or emoji fallback */}
      <View style={styles.listThumb}>
        {event.image ? (
          <Image
            source={{ uri: event.image }}
            style={styles.listThumbImage}
            resizeMode="cover"
          />
        ) : (
          <Text style={styles.listThumbIcon}>
            {getCategoryIcon(event.category)}
          </Text>
        )}
      </View>
      <View style={styles.listInfo}>
        <Text style={[styles.listCat, { color: catColor }]}>{(event.categoryLabel || event.category || '').toUpperCase()}</Text>
        <Text style={styles.listTitle} numberOfLines={1}>{event.title}</Text>
        <Text style={styles.listMeta}>📅 {event.date}  ⏰ {event.time}</Text>
        <Text style={styles.listVenue} numberOfLines={1}>📍 {event.venue}</Text>
      </View>
      <View style={styles.listRight}>
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation?.(); toggleSaved(event.id); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.saveBtn}
        >
          <Text style={[styles.saveBtnText, saved && { color: COLORS.accent }]}>
            {saved ? '♥' : '♡'}
          </Text>
        </TouchableOpacity>
        <View style={styles.listRatingBadge}>
          <Text style={styles.listRatingText}>★ {event.rating}</Text>
        </View>
        {isToday
          ? <View style={styles.listTodayBadge}><Text style={styles.listTodayText}>AZI</Text></View>
          : <Text style={styles.listPrice}>{event.price === 'Gratuit' ? '✓ Free' : event.price.split(' ')[0]}</Text>
        }
        <Text style={styles.listDistance}>{event.distance}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Featured card
  featuredCard: {
    width: 268,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    marginRight: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  featuredImage: {
    height: 162,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    backgroundColor: COLORS.surfaceAlt,
  },
  featuredImageIcon: { fontSize: 48 },
  catBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  catBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.8,
  },
  freeBadge: {
    position: 'absolute',
    top: 12,
    right: 40,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(34,197,94,0.9)',
  },
  freeBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.8,
  },
  featuredSaveBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredSaveIcon: { fontSize: 16, color: '#fff' },

  featuredInfo: { padding: 14 },
  featuredTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 3,
  },
  featuredDate: {
    fontSize: 11,
    color: COLORS.accent,
    fontWeight: '600',
    marginBottom: 6,
  },
  featuredMeta: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  metaText: { fontSize: 11, color: COLORS.textSecondary, flex: 1 },
  metaDot: { fontSize: 11, color: COLORS.textMuted, marginHorizontal: 4 },
  featuredBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ratingText: { fontSize: 12, color: COLORS.accent, fontWeight: '600' },
  distanceText: { fontSize: 11, color: COLORS.textMuted },

  todayBadge: {
    position: 'absolute',
    bottom: 12,
    right: 40,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(255,115,52,0.88)',
  },
  todayBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.8 },

  listTodayBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: COLORS.accentSoft,
    borderWidth: 1,
    borderColor: COLORS.accentMid,
  },
  listTodayText: { fontSize: 9, fontWeight: '800', color: COLORS.accent, letterSpacing: 0.5 },

  // List card
  listCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  listAccent: { width: 3, alignSelf: 'stretch' },
  listThumb: {
    width: 64,
    height: 64,
    margin: 10,
    marginLeft: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  listThumbImage: { width: 64, height: 64 },
  listThumbIcon: { fontSize: 24 },
  listInfo: { flex: 1, paddingVertical: 12 },
  listCat: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, marginBottom: 2 },
  listTitle: { fontSize: 13, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 3 },
  listMeta: { fontSize: 10, color: COLORS.textSecondary, marginBottom: 1 },
  listVenue: { fontSize: 10, color: COLORS.textMuted },
  listRight: { paddingHorizontal: 10, paddingVertical: 12, alignItems: 'flex-end', gap: 5 },
  saveBtn: { padding: 2 },
  saveBtnText: { fontSize: 18, color: COLORS.textMuted },
  listRatingBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255,115,52,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,115,52,0.28)',
  },
  listRatingText: { fontSize: 9, fontWeight: '800', color: COLORS.accent },
  listPrice: { fontSize: 11, color: COLORS.accent, fontWeight: '600' },
  listDistance: { fontSize: 10, color: COLORS.textMuted },
});
