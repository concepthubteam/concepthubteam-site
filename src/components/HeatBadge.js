import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

const HEAT_CONFIG = {
  packed:   { icon: '🔥', label: 'Packed',   color: '#EF4444', bg: 'rgba(239,68,68,0.18)',   glow: 'rgba(239,68,68,0.35)'  },
  busy:     { icon: '🟠', label: 'Busy',     color: '#FF7334', bg: 'rgba(255,115,52,0.18)',  glow: 'rgba(255,115,52,0.3)'  },
  moderate: { icon: '🟡', label: 'Activ',    color: '#F59E0B', bg: 'rgba(245,158,11,0.18)',  glow: 'rgba(245,158,11,0.2)'  },
  chill:    { icon: '🟢', label: 'Liniștit', color: '#22C55E', bg: 'rgba(34,197,94,0.15)',   glow: 'rgba(34,197,94,0.15)'  },
};

export default function HeatBadge({ level = 'chill', size = 'md', showLabel = true, pulse = false }) {
  const cfg = HEAT_CONFIG[level] || HEAT_CONFIG.chill;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse || level === 'chill') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, level, pulseAnim]);

  const isLg = size === 'lg';
  const isSm = size === 'sm';

  return (
    <Animated.View
      style={[
        styles.badge,
        { backgroundColor: cfg.bg, borderColor: cfg.color + '55' },
        isLg && styles.badgeLg,
        isSm && styles.badgeSm,
        { transform: [{ scale: pulseAnim }] },
      ]}
    >
      <Text style={[styles.icon, isLg && styles.iconLg, isSm && styles.iconSm]}>
        {cfg.icon}
      </Text>
      {showLabel && (
        <Text style={[styles.label, { color: cfg.color }, isLg && styles.labelLg, isSm && styles.labelSm]}>
          {cfg.label}
        </Text>
      )}
    </Animated.View>
  );
}

// Dot-only variant pentru hartă
export function HeatDot({ level = 'chill', size = 14 }) {
  const cfg = HEAT_CONFIG[level] || HEAT_CONFIG.chill;
  return (
    <View style={[styles.dot, {
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: cfg.color,
      shadowColor: cfg.color, shadowOpacity: 0.7,
      shadowRadius: size / 2, elevation: 4,
    }]} />
  );
}

// Bara de intensitate pentru venue card
export function HeatBar({ score = 0, maxScore = 120 }) {
  const pct = Math.min(score / maxScore, 1);
  const color = pct > 0.8 ? '#EF4444' : pct > 0.5 ? '#FF7334' : pct > 0.2 ? '#F59E0B' : '#22C55E';
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeLg: { paddingHorizontal: 14, paddingVertical: 8, gap: 7 },
  badgeSm: { paddingHorizontal: 7,  paddingVertical: 3, gap: 3  },

  icon:   { fontSize: 13 },
  iconLg: { fontSize: 18 },
  iconSm: { fontSize: 10 },

  label:   { fontSize: 11, fontWeight: '700', fontFamily: 'Arial' },
  labelLg: { fontSize: 14 },
  labelSm: { fontSize: 9  },

  dot: { shadowOffset: { width: 0, height: 0 } },

  barTrack: {
    height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 2 },
});

export { HEAT_CONFIG };
