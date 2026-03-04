import React, { useRef, useEffect } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { COLORS } from '../constants/colors';

// Animated placeholder box with pulse effect
function Bone({ style }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.55] });

  return (
    <Animated.View
      style={[{ backgroundColor: COLORS.surfaceAlt, borderRadius: 6, opacity }, style]}
    />
  );
}

// Skeleton for EventCard list variant
export function SkeletonListCard() {
  return (
    <View style={styles.listCard}>
      <View style={styles.listAccent} />
      <View style={styles.listThumb}>
        <Bone style={StyleSheet.absoluteFillObject} />
      </View>
      <View style={styles.listInfo}>
        <Bone style={styles.boneCatLabel} />
        <Bone style={styles.boneTitle} />
        <Bone style={styles.boneMeta} />
        <Bone style={styles.boneVenue} />
      </View>
      <View style={styles.listRight}>
        <Bone style={styles.boneSaveIcon} />
        <Bone style={styles.boneRating} />
        <Bone style={styles.bonePrice} />
        <Bone style={styles.boneDistance} />
      </View>
    </View>
  );
}

// Skeleton for EventCard featured variant (horizontal card)
export function SkeletonFeaturedCard() {
  return (
    <View style={styles.featuredCard}>
      <View style={styles.featuredImage}>
        <Bone style={StyleSheet.absoluteFillObject} />
        {/* Cat badge placeholder */}
        <View style={styles.catBadgeArea}>
          <Bone style={styles.boneCatBadge} />
        </View>
        {/* Save btn placeholder */}
        <View style={styles.saveBtnArea}>
          <Bone style={styles.boneSaveBtnCircle} />
        </View>
      </View>
      <View style={styles.featuredInfo}>
        <Bone style={styles.boneFeatTitle} />
        <Bone style={styles.boneFeatDate} />
        <Bone style={styles.boneFeatMeta} />
        <View style={styles.boneFeatBottom}>
          <Bone style={styles.boneFeatRating} />
          <Bone style={styles.boneFeatDist} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    height: 84,
  },
  listAccent: { width: 3, alignSelf: 'stretch', backgroundColor: COLORS.border },
  listThumb: {
    width: 64,
    height: 64,
    margin: 10,
    marginLeft: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceAlt,
    flexShrink: 0,
  },
  listInfo: { flex: 1, paddingVertical: 14, gap: 5 },
  listRight: {
    paddingHorizontal: 10,
    paddingVertical: 12,
    alignItems: 'flex-end',
    gap: 6,
  },

  // Bone sizes — list
  boneCatLabel: { width: 52, height: 8, borderRadius: 4 },
  boneTitle:    { width: 130, height: 12, borderRadius: 6 },
  boneMeta:     { width: 105, height: 9, borderRadius: 4 },
  boneVenue:    { width: 88, height: 9, borderRadius: 4 },
  boneSaveIcon: { width: 18, height: 18, borderRadius: 9 },
  boneRating:   { width: 34, height: 16, borderRadius: 4 },
  bonePrice:    { width: 28, height: 10, borderRadius: 4 },
  boneDistance: { width: 36, height: 9, borderRadius: 4 },

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
    backgroundColor: COLORS.surfaceAlt,
    overflow: 'hidden',
    position: 'relative',
  },
  catBadgeArea: { position: 'absolute', top: 12, left: 12 },
  saveBtnArea:  { position: 'absolute', top: 10, right: 10 },

  featuredInfo: { padding: 14, gap: 6 },

  // Bone sizes — featured
  boneCatBadge:    { width: 60, height: 18, borderRadius: 4 },
  boneSaveBtnCircle: { width: 28, height: 28, borderRadius: 14 },
  boneFeatTitle:   { width: 190, height: 14, borderRadius: 6 },
  boneFeatDate:    { width: 100, height: 10, borderRadius: 4 },
  boneFeatMeta:    { width: 155, height: 9, borderRadius: 4 },
  boneFeatBottom:  { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  boneFeatRating:  { width: 44, height: 11, borderRadius: 4 },
  boneFeatDist:    { width: 36, height: 11, borderRadius: 4 },
});
