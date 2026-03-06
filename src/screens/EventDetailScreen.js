import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, StatusBar, Linking, Share, Image, Alert, Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../constants/colors';
import { useSaved } from '../context/SavedContext';
import EventCard from '../components/EventCard';
import { useEvents } from '../context/EventsContext';
import {
  scheduleEventReminder,
  cancelEventReminder,
  getScheduledEventIds,
} from '../utils/notifications';
import { supabase, isConfigured } from '../lib/supabase';

export const HISTORY_KEY = '@gozi:history';

function getCategoryIcon(category) {
  const icons = {
    events: '🎉', restaurants: '🍽️', clubs: '🎶',
    kids: '👶', parks: '🌳', cinema: '🎬',
    sport: '🏋️', theatre: '🎭',
  };
  return icons[category] || '📍';
}

async function recordView(eventId) {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    const updated = [eventId, ...ids.filter(id => id !== eventId)].slice(0, 10);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch (_) {}
}

export default function EventDetailScreen({ route, navigation }) {
  const { events } = useEvents();
  // Suportă navigare directă (event={...}) SAU deep link (eventId="5")
  const { event: eventFromParams, eventId: deepLinkId } = route.params || {};
  const event = eventFromParams || events.find(e => e.id === Number(deepLinkId));
  const [reminderSet, setReminderSet] = useState(false);

  useEffect(() => {
    if (!event) return;
    recordView(event.id);
    getScheduledEventIds().then(ids => setReminderSet(ids.has(event.id)));
  }, [event?.id]);

  const { isSaved, toggleSaved } = useSaved();

  // Entry animations
  const contentAnim = useRef(new Animated.Value(0)).current;
  const contentSlide = useRef(new Animated.Value(28)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(contentAnim,  { toValue: 1, duration: 380, delay: 120, useNativeDriver: true }),
      Animated.timing(contentSlide, { toValue: 0, duration: 380, delay: 120, useNativeDriver: true }),
    ]).start();
  }, []);

  // Eveniment negăsit (deep link invalid sau events încă se încarcă)
  if (!event) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: COLORS.textMuted, fontSize: 14 }}>Eveniment negăsit</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 16 }}>
            <Text style={{ color: COLORS.accent, fontSize: 14 }}>← Înapoi</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const saved    = isSaved(event.id);
  const catColor = COLORS.cat[event.category] || COLORS.accent;

  const toggleReminder = async () => {
    if (reminderSet) {
      await cancelEventReminder(event.id);
      setReminderSet(false);
      Alert.alert('Reminder anulat', `Nu vei mai primi notificare pentru „${event.title}".`);
    } else {
      const id = await scheduleEventReminder(event);
      if (id) {
        setReminderSet(true);
        const msg = event.dateISO
          ? `Vei primi o notificare cu 1 oră înainte de eveniment.`
          : 'Acest loc e mereu deschis — nu are reminder de dată.';
        Alert.alert('Reminder setat! 🔔', msg);
      } else {
        Alert.alert('Permisiune necesară', 'Activează notificările pentru GOZI din Setări.');
      }
    }
  };

  const similar = events
    .filter(e => e.category === event.category && e.id !== event.id)
    .slice(0, 4);

  const openMaps = () => {
    Linking.openURL(`https://maps.google.com/?q=${event.lat},${event.lng}`);
  };

  const openLink = (url) => {
    if (url) Linking.openURL(url);
  };

  const callPhone = (phone) => {
    if (phone) Linking.openURL(`tel:${phone.replace(/\s/g, '')}`);
  };

  const shareEvent = async () => {
    const deepLink = `gozi://event/${event.id}`;
    await Share.share({
      message: `${event.title}\n📅 ${event.date}${event.time ? ' · ' + event.time : ''}\n📍 ${event.venue}\n💰 ${event.price}\n\n🔗 Deschide în GOZI: ${deepLink}\n📱 Descarcă GOZI!`,
      url: deepLink, // iOS — preview card cu link
      title: event.title,
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Hero — 280px immersive with overlaid controls */}
        <View style={styles.heroWrap}>
          {event.image ? (
            <Image
              source={{ uri: event.image }}
              style={StyleSheet.absoluteFillObject}
              resizeMode="cover"
            />
          ) : (
            <LinearGradient
              colors={[`${catColor}88`, `${catColor}22`, COLORS.surfaceAlt]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          )}

          {/* Top gradient for button readability */}
          <LinearGradient
            colors={['rgba(0,0,0,0.62)', 'transparent']}
            style={styles.heroTopGradient}
          />
          {/* Bottom fade into content */}
          <LinearGradient
            colors={['transparent', 'rgba(20,18,16,0.95)']}
            style={styles.heroBottomGradient}
          />

          {/* Overlaid top bar — circular buttons, no logo */}
          <View style={styles.topBar}>
            <TouchableOpacity style={styles.circleBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.circleBtnText}>←</Text>
            </TouchableOpacity>
            <View style={styles.topActions}>
              {/* Reminder bell */}
              {event.dateISO !== null && (
                <TouchableOpacity
                  style={[styles.circleBtn, reminderSet && styles.circleBtnReminder]}
                  onPress={toggleReminder}
                >
                  <Text style={[styles.circleBtnText, reminderSet && { color: '#F59E0B' }]}>
                    {reminderSet ? '🔔' : '🔕'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.circleBtn, saved && styles.circleBtnSaved]}
                onPress={() => toggleSaved(event.id)}
              >
                <Text style={[styles.circleBtnText, saved && { color: COLORS.accent }]}>
                  {saved ? '♥' : '♡'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.circleBtn} onPress={shareEvent}>
                <Text style={styles.circleBtnText}>↗</Text>
              </TouchableOpacity>
            </View>
          </View>

          {!event.image && (
            <Text style={styles.heroIcon}>{getCategoryIcon(event.category)}</Text>
          )}

          {/* Badges at hero bottom */}
          <View style={styles.heroFooter}>
            <View style={[styles.heroBadge, { backgroundColor: catColor }]}>
              <Text style={styles.heroBadgeText}>{(event.categoryLabel || event.category || '').toUpperCase()}</Text>
            </View>
            {event.price === 'Gratuit' && (
              <View style={styles.heroFreeBadge}>
                <Text style={styles.heroFreeBadgeText}>GRATUIT</Text>
              </View>
            )}
          </View>
        </View>

        {/* Content */}
        <Animated.View style={[styles.content, { opacity: contentAnim, transform: [{ translateY: contentSlide }] }]}>

          {/* Title + Rating */}
          <View style={styles.titleRow}>
            <Text style={styles.title}>{event.title}</Text>
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingText}>★ {event.rating}</Text>
            </View>
          </View>

          {/* Meta grid 2x2 */}
          <View style={styles.metaGrid}>
            <View style={styles.metaRow}>
              <View style={styles.metaCell}>
                <Text style={styles.metaIcon}>📅</Text>
                <View>
                  <Text style={styles.metaLabel}>DATA</Text>
                  <Text style={styles.metaValue}>{event.date}</Text>
                </View>
              </View>
              <View style={[styles.metaCell, styles.metaCellRight]}>
                <Text style={styles.metaIcon}>⏰</Text>
                <View>
                  <Text style={styles.metaLabel}>ORA</Text>
                  <Text style={styles.metaValue}>{event.time} — {event.timeEnd}</Text>
                </View>
              </View>
            </View>
            <View style={[styles.metaRow, styles.metaRowBorder]}>
              <View style={styles.metaCell}>
                <Text style={styles.metaIcon}>💰</Text>
                <View>
                  <Text style={styles.metaLabel}>PREȚ</Text>
                  <Text style={[styles.metaValue, event.price === 'Gratuit' && { color: '#22C55E' }]}>
                    {event.price}
                  </Text>
                </View>
              </View>
              <View style={[styles.metaCell, styles.metaCellRight]}>
                <Text style={styles.metaIcon}>📍</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.metaLabel}>LOCAȚIE</Text>
                  <Text style={styles.metaValue} numberOfLines={2}>{event.address}</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Description */}
          <Text style={styles.descLabel}>DESPRE</Text>
          <Text style={styles.desc}>{event.description}</Text>

          {/* Tags */}
          {(event.tags || []).length > 0 && (
            <View style={styles.tags}>
              {(event.tags || []).map(tag => (
                <View key={tag} style={styles.tag}>
                  <Text style={styles.tagText}>#{tag}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.divider} />

          {/* Venue + map */}
          <Text style={styles.descLabel}>LOCAȚIE</Text>
          <Text style={styles.venueName}>{event.venue}</Text>
          <Text style={styles.venueAddr}>{event.address}</Text>
          <TouchableOpacity style={styles.mapBtn} onPress={openMaps}>
            <Text style={styles.mapBtnText}>🗺️  Deschide în Maps</Text>
          </TouchableOpacity>

          {/* Contact & links */}
          {(event.website || event.phone || event.instagram || event.ticketsUrl) && (
            <>
              <View style={styles.divider} />
              <Text style={styles.descLabel}>CONTACT & LINKURI</Text>
              <View style={styles.linksGrid}>
                {event.website && (
                  <TouchableOpacity style={styles.linkBtn} onPress={() => openLink(event.website)} activeOpacity={0.8}>
                    <Text style={styles.linkIcon}>🌐</Text>
                    <View style={styles.linkInfo}>
                      <Text style={styles.linkLabel}>WEBSITE</Text>
                      <Text style={styles.linkValue} numberOfLines={1}>{event.website.replace('https://', '')}</Text>
                    </View>
                    <Text style={styles.linkArrow}>↗</Text>
                  </TouchableOpacity>
                )}
                {event.phone && (
                  <TouchableOpacity style={styles.linkBtn} onPress={() => callPhone(event.phone)} activeOpacity={0.8}>
                    <Text style={styles.linkIcon}>📞</Text>
                    <View style={styles.linkInfo}>
                      <Text style={styles.linkLabel}>TELEFON</Text>
                      <Text style={styles.linkValue}>{event.phone}</Text>
                    </View>
                    <Text style={styles.linkArrow}>↗</Text>
                  </TouchableOpacity>
                )}
                {event.instagram && (
                  <TouchableOpacity
                    style={styles.linkBtn}
                    onPress={() => openLink(`https://instagram.com/${event.instagram.replace('@', '')}`)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.linkIcon}>📸</Text>
                    <View style={styles.linkInfo}>
                      <Text style={styles.linkLabel}>INSTAGRAM</Text>
                      <Text style={styles.linkValue}>{event.instagram}</Text>
                    </View>
                    <Text style={styles.linkArrow}>↗</Text>
                  </TouchableOpacity>
                )}
                {event.ticketsUrl && (
                  <TouchableOpacity
                    style={[styles.linkBtn, styles.linkBtnTickets]}
                    onPress={() => {
                      if (isConfigured) {
                        supabase
                          .from('events')
                          .update({ ticket_clicks: (event.ticketClicks || 0) + 1 })
                          .eq('id', event.id)
                          .then(() => {}).catch(() => {});
                      }
                      openLink(event.ticketsUrl);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.linkIcon}>🎟️</Text>
                    <View style={styles.linkInfo}>
                      <Text style={[styles.linkLabel, { color: catColor }]}>BILETE ONLINE</Text>
                      <Text style={[styles.linkValue, { color: catColor }]}>Cumpără bilet</Text>
                    </View>
                    <Text style={[styles.linkArrow, { color: catColor }]}>↗</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}
        </Animated.View>

        {/* Similar events */}
        {similar.length > 0 && (
          <View style={styles.similarSection}>
            <View style={styles.similarHeader}>
              <Text style={styles.similarLabel}>MAI MULTE DIN</Text>
              <Text style={[styles.similarCat, { color: catColor }]}>
                {getCategoryIcon(event.category)} {(event.categoryLabel || event.category || '').toUpperCase()}
              </Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.similarScroll}
            >
              {similar.map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  featured
                  onPress={() => navigation.replace('EventDetail', { event: e })}
                />
              ))}
            </ScrollView>
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Bottom CTA */}
      <View style={styles.bottomCTA}>
        <View style={styles.ctaInfo}>
          <Text style={styles.ctaTime}>{event.time}</Text>
          <Text style={styles.ctaDistance}>{event.distance} distanță</Text>
        </View>
        <TouchableOpacity
          style={[styles.ctaBtn, { backgroundColor: catColor }]}
          activeOpacity={0.85}
          onPress={() => {
            if (event.ticketsUrl) {
              // Track ticket click — fire & forget, nu blochează UI
              if (isConfigured) {
                supabase
                  .from('events')
                  .update({ ticket_clicks: (event.ticketClicks || 0) + 1 })
                  .eq('id', event.id)
                  .then(() => {}).catch(() => {});
              }
              openLink(event.ticketsUrl);
            } else {
              openMaps();
            }
          }}
        >
          <Text style={styles.ctaBtnText}>
            {event.price === 'Gratuit'
              ? '📍 Deschide în Maps'
              : event.ticketsUrl
              ? '🎟️ Cumpără bilet'
              : '📍 Deschide în Maps'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  heroWrap: {
    height: 280,
    position: 'relative',
    backgroundColor: COLORS.surfaceAlt,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTopGradient: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 110,
    zIndex: 1,
  },
  heroBottomGradient: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 110,
    zIndex: 1,
  },
  heroIcon: { fontSize: 72, zIndex: 2 },
  heroFooter: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 8,
    zIndex: 3,
  },
  heroBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  heroBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff', letterSpacing: 1 },
  heroFreeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(34,197,94,0.9)',
  },
  heroFreeBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff', letterSpacing: 1 },

  topBar: {
    position: 'absolute',
    top: 12,
    left: 0, right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    zIndex: 5,
  },
  circleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.48)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  circleBtnText: { fontSize: 18, color: '#fff' },
  circleBtnSaved: { backgroundColor: 'rgba(255,115,52,0.45)', borderColor: COLORS.accent },
  circleBtnReminder: { backgroundColor: 'rgba(245,158,11,0.35)', borderColor: '#F59E0B' },
  topActions: { flexDirection: 'row', gap: 8 },

  content: { padding: 20 },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.textPrimary,
    lineHeight: 30,
    letterSpacing: -0.5,
  },
  ratingBadge: {
    backgroundColor: COLORS.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.accentMid,
  },
  ratingText: { fontSize: 13, fontWeight: '700', color: COLORS.accent },

  metaGrid: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  metaRow: { flexDirection: 'row' },
  metaRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.border },
  metaCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
  },
  metaCellRight: { borderLeftWidth: 1, borderLeftColor: COLORS.border },
  metaIcon: { fontSize: 18, width: 24 },
  metaLabel: { fontSize: 9, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1, marginBottom: 3 },
  metaValue: { fontSize: 13, fontWeight: '600', color: COLORS.textPrimary },

  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 20 },

  descLabel: { fontSize: 9, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.2, marginBottom: 10 },
  desc: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 22 },

  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  tag: {
    backgroundColor: COLORS.surface,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tagText: { fontSize: 11, color: COLORS.textSecondary },

  venueName: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 4 },
  venueAddr: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 14 },
  mapBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  mapBtnText: { fontSize: 13, fontWeight: '600', color: COLORS.textPrimary },

  linksGrid: { gap: 8 },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    gap: 12,
  },
  linkBtnTickets: {
    borderColor: 'rgba(255,115,52,0.3)',
    backgroundColor: COLORS.accentSoft,
  },
  linkIcon: { fontSize: 20, width: 28 },
  linkInfo: { flex: 1 },
  linkLabel: { fontSize: 9, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1, marginBottom: 2 },
  linkValue: { fontSize: 13, fontWeight: '600', color: COLORS.textPrimary },
  linkArrow: { fontSize: 16, color: COLORS.textMuted },

  similarSection: { marginBottom: 8 },
  similarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  similarLabel: { fontSize: 9, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.2 },
  similarCat: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  similarScroll: { paddingHorizontal: 20 },

  bottomCTA: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingBottom: 28,
  },
  ctaInfo: {},
  ctaTime: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary },
  ctaDistance: { fontSize: 11, color: COLORS.textSecondary },
  ctaBtn: {
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 12,
    flex: 1,
    marginLeft: 16,
    alignItems: 'center',
  },
  ctaBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
