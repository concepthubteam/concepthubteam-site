import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, StatusBar, Dimensions, Image, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../constants/colors';

const LOGO = require('../../assets/logo.png');

const { width, height } = Dimensions.get('window');
const ONBOARDING_KEY = '@gozi:onboarded';
const HERO_HEIGHT = height * 0.38;

const SLIDES = [
  {
    id: '1',
    image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&h=500&fit=crop',
    title: 'Bine ai venit în\nGOZI',
    subtitle: 'Descoperă tot ce se întâmplă în București',
    features: [
      { icon: '🎉', text: 'Concerte, teatru, sport și mai mult' },
      { icon: '📍', text: 'Evenimente în zona ta, pe hartă' },
      { icon: '🆓', text: 'Filtrează cele gratuite instant' },
    ],
    accent: COLORS.accent,
    showLogo: true,
  },
  {
    id: '2',
    image: 'https://images.unsplash.com/photo-1524661135-423995f22d0b?w=600&h=500&fit=crop',
    title: 'Totul pe hartă',
    subtitle: 'Localizează-te și descoperă ce e aproape',
    features: [
      { icon: '🗺️', text: 'Hartă interactivă dark mode' },
      { icon: '📅', text: 'Filtrează: azi, mâine, weekend' },
      { icon: '↑', text: 'Sortare după distanță față de tine' },
    ],
    accent: '#3B82F6',
    emoji: '🗺️',
  },
  {
    id: '3',
    image: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&h=500&fit=crop',
    title: 'Salvează ce-ți place',
    subtitle: 'Colecția ta personală de locuri și events',
    features: [
      { icon: '♥', text: 'Adaugă la favorite cu un singur tap' },
      { icon: '⊞', text: 'Sortare și grupare pe categorii' },
      { icon: '🔔', text: 'Reminder înainte de eveniment' },
    ],
    accent: '#EC4899',
    emoji: '♥',
  },
  {
    id: '4',
    image: 'https://images.unsplash.com/photo-1518085250887-2f903c200fee?w=600&h=500&fit=crop',
    title: 'Explorează București',
    subtitle: 'Caută, filtrează, descoperă',
    features: [
      { icon: '🔍', text: 'Caută după orice cuvânt sau tag' },
      { icon: '🏷️', text: 'Taguri populare cu un singur tap' },
      { icon: '🔥', text: 'Trending și gratuit în primul rând' },
    ],
    accent: '#10B981',
    emoji: '🔍',
  },
];

export default function OnboardingScreen({ onDone }) {
  const [index, setIndex] = useState(0);
  const scrollRef = useRef(null);
  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  const goTo = (i) => {
    scrollRef.current?.scrollTo({ x: i * width, animated: true });
    setIndex(i);
  };

  const next = async () => {
    if (isLast) {
      await AsyncStorage.setItem(ONBOARDING_KEY, '1');
      onDone();
    } else {
      goTo(index + 1);
    }
  };

  const skip = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    onDone();
  };

  const onMomentumScrollEnd = (e) => {
    const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex(newIndex);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      {/* Top bar — step counter + skip */}
      <View style={styles.topBar}>
        <View style={styles.stepCounter}>
          <Text style={styles.stepText}>{index + 1} / {SLIDES.length}</Text>
        </View>
        {!isLast && (
          <TouchableOpacity style={styles.skipBtn} onPress={skip} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.skipText}>Sari →</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Swipeable slides */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEventThrottle={16}
        style={styles.pager}
      >
        {SLIDES.map((s) => (
          <View key={s.id} style={styles.slide}>
            {/* Hero image */}
            <View style={styles.heroArea}>
              <Image
                source={{ uri: s.image }}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
              />
              <LinearGradient
                colors={['rgba(20,18,16,0.15)', `${s.accent}55`, COLORS.bg]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={styles.heroCenter}>
                {s.showLogo ? (
                  <View style={styles.heroLogoWrap}>
                    <Image source={LOGO} style={styles.heroLogo} resizeMode="contain" />
                  </View>
                ) : (
                  <View style={[styles.heroEmojiWrap, { borderColor: `${s.accent}55`, backgroundColor: `${s.accent}18` }]}>
                    <Text style={styles.heroEmoji}>{s.emoji}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Text content */}
            <View style={styles.content}>
              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.subtitle}>{s.subtitle}</Text>
              <View style={styles.featureList}>
                {s.features.map((f, i) => (
                  <View key={i} style={styles.featureRow}>
                    <View style={[styles.featureIconWrap, { backgroundColor: `${s.accent}18`, borderColor: `${s.accent}33` }]}>
                      <Text style={styles.featureIcon}>{f.icon}</Text>
                    </View>
                    <Text style={styles.featureText}>{f.text}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Dots — tappable, scroll la slide */}
      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => goTo(i)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <View style={[
              styles.dot,
              i === index
                ? [styles.dotActive, { backgroundColor: slide.accent }]
                : styles.dotInactive,
            ]} />
          </TouchableOpacity>
        ))}
      </View>

      {/* CTA button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: slide.accent }]}
          onPress={next}
          activeOpacity={0.85}
        >
          <Text style={styles.nextBtnText}>
            {isLast ? '🚀  Hai să explorăm!' : 'Continuă  →'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export async function hasOnboarded() {
  try {
    const val = await AsyncStorage.getItem(ONBOARDING_KEY);
    return val === '1';
  } catch {
    return true;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  topBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  stepCounter: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  stepText: { fontSize: 11, color: COLORS.textSecondary, fontWeight: '700' },
  skipBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  skipText: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '600' },

  pager: { flex: 1 },

  slide: {
    width,
    flex: 1,
  },

  heroArea: {
    height: HERO_HEIGHT,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroCenter: { alignItems: 'center', justifyContent: 'center' },
  heroLogoWrap: {
    width: 160,
    height: 64,
    backgroundColor: 'rgba(20,18,16,0.6)',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 16,
  },
  heroLogo: { width: '100%', height: '100%' },
  heroEmojiWrap: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  heroEmoji: { fontSize: 42 },

  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 24,
    justifyContent: 'flex-start',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: COLORS.textPrimary,
    lineHeight: 34,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 22,
  },
  featureList: { gap: 12 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  featureIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  featureIcon: { fontSize: 18 },
  featureText: { flex: 1, fontSize: 13, color: COLORS.textPrimary, fontWeight: '500', lineHeight: 18 },

  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  dot: { borderRadius: 4 },
  dotActive: { width: 24, height: 8 },
  dotInactive: { width: 8, height: 8, backgroundColor: COLORS.border },

  footer: {
    paddingHorizontal: 24,
    paddingBottom: 36,
  },
  nextBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.3,
  },
});
