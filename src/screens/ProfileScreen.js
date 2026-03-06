import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, StatusBar, Switch, Alert, Image,
  TextInput, Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../constants/colors';
import { useSaved } from '../context/SavedContext';
import { CATEGORIES } from '../data/mockData';
import { HISTORY_KEY } from './EventDetailScreen';
import { useEvents } from '../context/EventsContext';
import { useAuth } from '../context/AuthContext';
import { useCityPulse } from '../context/CityPulseContext';
import AuthScreen from './AuthScreen';

const LOGO = require('../../assets/logo.png');
const PROFILE_KEY = '@gozi:profile';
const AVATAR_OPTIONS = ['🏙️', '😊', '🎭', '🌟', '🔥', '💫', '🌆', '🎪', '🦁', '🐯'];

function buildAchievements(savedEvents) {
  const total = savedEvents.length;
  const restaurants = savedEvents.filter(e => e.category === 'restaurants').length;
  const clubs = savedEvents.filter(e => e.category === 'clubs').length;
  const sport = savedEvents.filter(e => e.category === 'sport').length;
  const theatre = savedEvents.filter(e => e.category === 'theatre').length;
  const free = savedEvents.filter(e => e.price === 'Gratuit').length;
  return [
    { id: 'explorer',  icon: '🗺️', label: 'Explorator',  desc: `${total}/5 locuri salvate`,      done: total >= 5 },
    { id: 'foodie',    icon: '🍽️', label: 'Foodie',       desc: `${restaurants}/3 restaurante`,   done: restaurants >= 3 },
    { id: 'nightlife', icon: '🎶', label: 'Nocturn',      desc: `${clubs}/3 cluburi/concerte`,    done: clubs >= 3 },
    { id: 'sport',     icon: '🏋️', label: 'Activ',        desc: `${sport}/2 activități sport`,   done: sport >= 2 },
    { id: 'culture',   icon: '🎭', label: 'Cult',         desc: `${theatre}/3 spectacole`,        done: theatre >= 3 },
    { id: 'free',      icon: '🆓', label: 'Econom',       desc: `${free}/5 events gratuite`,      done: free >= 5 },
  ];
}

export default function ProfileScreen({ navigation }) {
  const { events } = useEvents();
  const { savedIds, clearSaved } = useSaved();
  const { user, signOut } = useAuth();
  const { optedIn, setOptIn } = useCityPulse();
  const [authVisible, setAuthVisible] = useState(false);
  const savedEvents = events.filter(e => savedIds.has(e.id));

  const [profile, setProfile] = useState({
    name: 'Exploratorul Bucureștean',
    avatarIdx: 0,
    type: 'individual',
    gender: null,
    birthday: '',
  });
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const [notifEvents,   setNotifEvents]   = useState(true);
  const [notifPromo,    setNotifPromo]    = useState(false);
  const [notifReminder, setNotifReminder] = useState(true);
  const [recentIds,     setRecentIds]     = useState([]);

  useEffect(() => {
    AsyncStorage.getItem(PROFILE_KEY).then(raw => {
      if (raw) {
        try { setProfile(JSON.parse(raw)); } catch (_) {}
      }
    });
    AsyncStorage.getItem(HISTORY_KEY).then(raw => {
      if (raw) {
        try { setRecentIds(JSON.parse(raw).slice(0, 5)); } catch (_) {}
      }
    });
  }, []);

  const recentEvents = recentIds
    .map(id => events.find(e => e.id === id))
    .filter(Boolean);

  const saveProfile = (updated) => {
    setProfile(updated);
    AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(updated)).catch(() => {});
  };

  const handleAvatarCycle = () => {
    saveProfile({ ...profile, avatarIdx: (profile.avatarIdx + 1) % AVATAR_OPTIONS.length });
  };

  const handleNameSave = () => {
    if (nameInput.trim()) saveProfile({ ...profile, name: nameInput.trim() });
    setEditingName(false);
  };

  const handleClearSaved = () => {
    Alert.alert(
      'Șterge toate salvările',
      `Ești sigur că vrei să ștergi cele ${savedEvents.length} locații salvate?`,
      [
        { text: 'Anulează', style: 'cancel' },
        { text: 'Șterge', style: 'destructive', onPress: () => clearSaved() },
      ]
    );
  };

  const handleResetOnboarding = () => {
    Alert.alert(
      'Resetează onboarding',
      'La repornire vei vedea din nou ecranul de introducere.',
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Resetează',
          onPress: () => {
            AsyncStorage.removeItem('@gozi:onboarded').catch(() => {});
            Alert.alert('Gata!', 'Repornește aplicația pentru a vedea onboarding-ul.');
          },
        },
      ]
    );
  };

  const catCounts = {};
  savedEvents.forEach(e => { catCounts[e.category] = (catCounts[e.category] || 0) + 1; });
  const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
  const topCatInfo = topCat ? CATEGORIES.find(c => c.id === topCat[0]) : null;
  const achievements = buildAchievements(savedEvents);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <View style={styles.header}>
        <Image source={LOGO} style={styles.logoImg} resizeMode="contain" />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Profile Hero — editabil */}
        <View style={styles.profileHero}>
          <TouchableOpacity style={styles.avatarWrap} onPress={handleAvatarCycle} activeOpacity={0.8}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{AVATAR_OPTIONS[profile.avatarIdx]}</Text>
            </View>
            <View style={styles.avatarEditBadge}>
              <Text style={styles.avatarEditText}>✎</Text>
            </View>
          </TouchableOpacity>

          {editingName ? (
            <View style={styles.nameEditRow}>
              <TextInput
                style={styles.nameInput}
                value={nameInput}
                onChangeText={setNameInput}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleNameSave}
                placeholderTextColor={COLORS.textMuted}
              />
              <TouchableOpacity style={styles.nameSaveBtn} onPress={handleNameSave}>
                <Text style={styles.nameSaveBtnText}>✓</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.nameRow}
              onPress={() => { setNameInput(profile.name); setEditingName(true); }}
              activeOpacity={0.7}
            >
              <Text style={styles.profileName}>{profile.name}</Text>
              <Text style={styles.nameEditIcon}>✎</Text>
            </TouchableOpacity>
          )}

          {/* Tip selector */}
          <View style={styles.typeRow}>
            {[
              { val: 'individual', label: '👤 Persoană fizică' },
              { val: 'company',    label: '🏢 Companie' },
            ].map(({ val, label }) => (
              <TouchableOpacity
                key={val}
                style={[styles.typeChip, profile.type === val && styles.typeChipActive]}
                onPress={() => saveProfile({ ...profile, type: val })}
                activeOpacity={0.8}
              >
                <Text style={[styles.typeChipText, profile.type === val && styles.typeChipTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.profileSub}>Membru din Martie 2026</Text>
          <View style={styles.accentLine} />
        </View>

        {/* Auth card */}
        <View style={styles.section}>
          {user ? (
            <View style={styles.authCard}>
              <View style={styles.authCardLeft}>
                <View style={styles.authAvatarCircle}>
                  <Text style={styles.authAvatarIcon}>👤</Text>
                </View>
                <View>
                  <Text style={styles.authEmail} numberOfLines={1}>{user.email}</Text>
                  <Text style={styles.authStatus}>● Conectat</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.signOutBtn}
                onPress={() => {
                  Alert.alert('Deconectare', 'Ești sigur că vrei să te deconectezi?', [
                    { text: 'Anulează', style: 'cancel' },
                    { text: 'Deconectare', style: 'destructive', onPress: signOut },
                  ]);
                }}
              >
                <Text style={styles.signOutBtnText}>Ieșire</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.loginCard} onPress={() => setAuthVisible(true)} activeOpacity={0.85}>
              <Text style={styles.loginCardIcon}>🔐</Text>
              <View style={styles.loginCardTexts}>
                <Text style={styles.loginCardTitle}>Conectează-te</Text>
                <Text style={styles.loginCardSub}>Salvează preferințele în cloud</Text>
              </View>
              <Text style={styles.loginCardArrow}>→</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Submit event shortcut */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.submitEventBtn}
            onPress={() => navigation.navigate('SubmitEvent')}
            activeOpacity={0.85}
          >
            <Text style={styles.submitEventIcon}>📤</Text>
            <View style={styles.submitEventTexts}>
              <Text style={styles.submitEventTitle}>Adaugă un eveniment</Text>
              <Text style={styles.submitEventSub}>Știi ceva mișto? Spune-ne!</Text>
            </View>
            <Text style={styles.submitEventArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {/* TikTok Inbox — admin */}
        <View style={[styles.section, { marginTop: 12 }]}>
          <TouchableOpacity
            style={styles.tiktokInboxBtn}
            onPress={() => navigation.navigate('TikTokInbox')}
            activeOpacity={0.85}
          >
            <Text style={styles.submitEventIcon}>🎵</Text>
            <View style={styles.submitEventTexts}>
              <Text style={styles.submitEventTitle}>TikTok Inbox</Text>
              <Text style={styles.submitEventSub}>Validare semnale extrase (admin)</Text>
            </View>
            <Text style={styles.submitEventArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {/* AuthScreen modal */}
        <Modal visible={authVisible} transparent animationType="none" onRequestClose={() => setAuthVisible(false)}>
          <AuthScreen onClose={() => setAuthVisible(false)} />
        </Modal>

        {/* Date personale */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>👤 DATE PERSONALE</Text>
          <View style={styles.settingsCard}>
            {/* Gen */}
            <View style={[styles.settingRow, styles.settingRowWrap]}>
              <View style={styles.settingLeft}>
                <Text style={styles.settingIcon}>⚧</Text>
                <Text style={styles.settingTitle}>Gen</Text>
              </View>
              <View style={styles.genderRow}>
                {[['M', 'Bărbat'], ['F', 'Femeie'], ['O', 'Altul']].map(([val, label]) => (
                  <TouchableOpacity
                    key={val}
                    style={[styles.genderChip, profile.gender === val && styles.genderChipActive]}
                    onPress={() => saveProfile({ ...profile, gender: profile.gender === val ? null : val })}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.genderChipText, profile.gender === val && styles.genderChipTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.settingDivider} />
            {/* Birthday */}
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}>
                <Text style={styles.settingIcon}>🎂</Text>
                <View>
                  <Text style={styles.settingTitle}>Data nașterii</Text>
                  <Text style={styles.settingDesc}>Format ZZ/LL/AAAA</Text>
                </View>
              </View>
              <TextInput
                style={styles.birthdayInput}
                value={profile.birthday}
                onChangeText={v => saveProfile({ ...profile, birthday: v })}
                placeholder="01/01/1990"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
                maxLength={10}
              />
            </View>
          </View>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{savedEvents.length}</Text>
            <Text style={styles.statLabel}>SALVATE</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{events.length}</Text>
            <Text style={styles.statLabel}>DISPONIBILE</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>
              {topCatInfo ? topCatInfo.icon : '—'}
            </Text>
            <Text style={styles.statLabel}>
              {topCatInfo ? topCatInfo.label.toUpperCase().slice(0, 7) : 'FAV. CAT.'}
            </Text>
          </View>
        </View>

        {/* Vizitate recent */}
        {recentEvents.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>🕐 VIZITATE RECENT</Text>
            <View style={styles.settingsCard}>
              {recentEvents.map((e, i) => {
                const catColor = COLORS.cat[e.category] || COLORS.accent;
                return (
                  <View key={e.id}>
                    <TouchableOpacity
                      style={styles.settingRow}
                      onPress={() => navigation.navigate('EventDetail', { event: e })}
                      activeOpacity={0.7}
                    >
                      <View style={styles.settingLeft}>
                        <View style={[styles.recentThumb, { backgroundColor: `${catColor}22` }]}>
                          {e.image ? (
                            <Image source={{ uri: e.image }} style={styles.recentThumbImg} resizeMode="cover" />
                          ) : (
                            <Text style={styles.recentThumbIcon}>{(e.categoryLabel || e.category || '?').slice(0, 1)}</Text>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.settingTitle} numberOfLines={1}>{e.title}</Text>
                          <Text style={styles.settingDesc}>{e.venue} · {e.price}</Text>
                        </View>
                      </View>
                      <Text style={[styles.settingValue, { color: catColor }]}>→</Text>
                    </TouchableOpacity>
                    {i < recentEvents.length - 1 && <View style={styles.settingDivider} />}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Achievements */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            🏆 REALIZĂRI — {achievements.filter(a => a.done).length}/{achievements.length}
          </Text>
          <View style={styles.achievementsGrid}>
            {achievements.map(a => (
              <View
                key={a.id}
                style={[styles.achieveCard, !a.done && styles.achieveCardLocked]}
              >
                <Text style={[styles.achieveIcon, !a.done && styles.achieveIconLocked]}>
                  {a.done ? a.icon : '🔒'}
                </Text>
                <Text style={[styles.achieveLabel, !a.done && { color: COLORS.textMuted }]}>
                  {a.label}
                </Text>
                <Text style={styles.achieveDesc}>{a.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Categorii favorite */}
        {savedEvents.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>❤️ CATEGORII FAVORITE</Text>
            <View style={styles.favCats}>
              {Object.entries(catCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([catId, count]) => {
                  const cat = CATEGORIES.find(c => c.id === catId);
                  if (!cat) return null;
                  return (
                    <View key={catId} style={[styles.favCatChip, { borderColor: cat.color + '66', backgroundColor: cat.color + '18' }]}>
                      <Text style={styles.favCatIcon}>{cat.icon}</Text>
                      <Text style={[styles.favCatLabel, { color: cat.color }]}>{cat.label}</Text>
                      <Text style={styles.favCatCount}>{count}</Text>
                    </View>
                  );
                })}
            </View>
          </View>
        )}

        {/* City Pulse */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>🔥 CITY PULSE</Text>
          <View style={styles.settingsCard}>
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}>
                <Text style={styles.settingIcon}>📡</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingTitle}>Radar anonim activ</Text>
                  <Text style={styles.settingDesc}>Semnal GPS anonim · fără date personale</Text>
                </View>
              </View>
              <Switch
                value={optedIn}
                onValueChange={v => setOptIn(v)}
                trackColor={{ false: COLORS.border, true: COLORS.accentMid }}
                thumbColor={optedIn ? COLORS.accent : COLORS.textMuted}
              />
            </View>
            <View style={styles.settingDivider} />
            <TouchableOpacity
              style={styles.settingRow}
              onPress={() => navigation.navigate('CityPulse')}
              activeOpacity={0.7}
            >
              <View style={styles.settingLeft}>
                <Text style={styles.settingIcon}>🏙️</Text>
                <View>
                  <Text style={styles.settingTitle}>Deschide City Pulse</Text>
                  <Text style={styles.settingDesc}>Locuri active acum în București</Text>
                </View>
              </View>
              <Text style={styles.settingValue}>→</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Notificări */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>🔔 NOTIFICĂRI</Text>
          <View style={styles.settingsCard}>
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}>
                <Text style={styles.settingIcon}>🎉</Text>
                <View>
                  <Text style={styles.settingTitle}>Evenimente noi</Text>
                  <Text style={styles.settingDesc}>Notificări pentru events în zona ta</Text>
                </View>
              </View>
              <Switch
                value={notifEvents}
                onValueChange={setNotifEvents}
                trackColor={{ false: COLORS.border, true: COLORS.accentMid }}
                thumbColor={notifEvents ? COLORS.accent : COLORS.textMuted}
              />
            </View>
            <View style={styles.settingDivider} />
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}>
                <Text style={styles.settingIcon}>⏰</Text>
                <View>
                  <Text style={styles.settingTitle}>Reminder înainte de event</Text>
                  <Text style={styles.settingDesc}>Cu 1 oră înainte de evenimentele salvate</Text>
                </View>
              </View>
              <Switch
                value={notifReminder}
                onValueChange={setNotifReminder}
                trackColor={{ false: COLORS.border, true: COLORS.accentMid }}
                thumbColor={notifReminder ? COLORS.accent : COLORS.textMuted}
              />
            </View>
            <View style={styles.settingDivider} />
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}>
                <Text style={styles.settingIcon}>🏷️</Text>
                <View>
                  <Text style={styles.settingTitle}>Oferte & reduceri</Text>
                  <Text style={styles.settingDesc}>Prețuri speciale și oferte limitate</Text>
                </View>
              </View>
              <Switch
                value={notifPromo}
                onValueChange={setNotifPromo}
                trackColor={{ false: COLORS.border, true: COLORS.accentMid }}
                thumbColor={notifPromo ? COLORS.accent : COLORS.textMuted}
              />
            </View>
          </View>
        </View>

        {/* Aplicație */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>⚙️ APLICAȚIE</Text>
          <View style={styles.settingsCard}>
            {[
              { icon: '📍', label: 'Locație implicită', value: 'București' },
              { icon: '🌐', label: 'Limbă', value: 'Română' },
              { icon: '🎨', label: 'Temă', value: 'Dark (activ)' },
              { icon: '📋', label: 'Versiune', value: '1.0.0' },
            ].map((item, i, arr) => (
              <View key={item.label}>
                <TouchableOpacity style={styles.settingRow} activeOpacity={0.7}>
                  <View style={styles.settingLeft}>
                    <Text style={styles.settingIcon}>{item.icon}</Text>
                    <Text style={styles.settingTitle}>{item.label}</Text>
                  </View>
                  <Text style={styles.settingValue}>{item.value}</Text>
                </TouchableOpacity>
                {i < arr.length - 1 && <View style={styles.settingDivider} />}
              </View>
            ))}
          </View>
        </View>

        {/* Shortcut salvate */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.savedShortcut}
            onPress={() => navigation.navigate('Saved')}
            activeOpacity={0.85}
          >
            <Text style={styles.savedShortcutIcon}>♥</Text>
            <Text style={styles.savedShortcutText}>
              {savedEvents.length > 0
                ? `Vezi cele ${savedEvents.length} locații salvate`
                : 'Nu ai salvat nicio locație încă'}
            </Text>
            <Text style={styles.savedShortcutArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {/* Acțiuni */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>⚠️ ACȚIUNI</Text>
          <View style={styles.settingsCard}>
            <TouchableOpacity
              style={styles.settingRow}
              onPress={handleClearSaved}
              activeOpacity={0.7}
              disabled={savedEvents.length === 0}
            >
              <View style={styles.settingLeft}>
                <Text style={styles.settingIcon}>🗑️</Text>
                <View>
                  <Text style={[styles.settingTitle, { color: savedEvents.length > 0 ? COLORS.accent : COLORS.textMuted }]}>
                    Șterge toate salvările
                  </Text>
                  <Text style={styles.settingDesc}>
                    {savedEvents.length > 0 ? `${savedEvents.length} locații salvate` : 'Nimic de șters'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
            <View style={styles.settingDivider} />
            <TouchableOpacity
              style={styles.settingRow}
              onPress={handleResetOnboarding}
              activeOpacity={0.7}
            >
              <View style={styles.settingLeft}>
                <Text style={styles.settingIcon}>🔄</Text>
                <View>
                  <Text style={styles.settingTitle}>Resetează onboarding</Text>
                  <Text style={styles.settingDesc}>Revezi prezentarea la repornire</Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 110 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

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

  profileHero: {
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  avatarWrap: { position: 'relative', marginBottom: 14 },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.accentMid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 40 },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.bg,
  },
  avatarEditText: { fontSize: 11, color: '#fff', fontWeight: '700' },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  profileName: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary },
  nameEditIcon: { fontSize: 14, color: COLORS.textMuted },

  nameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    width: '100%',
    paddingHorizontal: 20,
  },
  nameInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.accentMid,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  nameSaveBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameSaveBtnText: { fontSize: 18, color: '#fff', fontWeight: '700' },

  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  typeChipActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft },
  typeChipText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
  typeChipTextActive: { color: COLORS.accent },

  profileSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  accentLine: {
    width: 40, height: 3,
    backgroundColor: COLORS.accent,
    borderRadius: 2,
    marginTop: 14,
  },

  statsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 20,
    marginTop: 4,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 4 },
  statLabel: { fontSize: 9, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1 },
  statDivider: { width: 1, backgroundColor: COLORS.border },

  section: { marginTop: 28, paddingHorizontal: 16 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1.5,
    marginBottom: 14,
  },

  settingsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  settingRowWrap: { flexWrap: 'wrap', gap: 10 },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  settingIcon: { fontSize: 18, width: 26 },
  settingTitle: { fontSize: 13, fontWeight: '600', color: COLORS.textPrimary },
  settingDesc: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
  settingValue: { fontSize: 12, color: COLORS.textMuted },
  settingDivider: { height: 1, backgroundColor: COLORS.border, marginHorizontal: 16 },

  genderRow: { flexDirection: 'row', gap: 6 },
  genderChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
  },
  genderChipActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft },
  genderChipText: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary },
  genderChipTextActive: { color: COLORS.accent },

  recentThumb: {
    width: 40,
    height: 40,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  recentThumbImg: { width: 40, height: 40 },
  recentThumbIcon: { fontSize: 18 },

  birthdayInput: {
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'center',
    minWidth: 110,
  },

  achievementsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  achieveCard: {
    width: '47%',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.accentMid,
    alignItems: 'center',
    gap: 6,
  },
  achieveCardLocked: { borderColor: COLORS.border, opacity: 0.6 },
  achieveIcon: { fontSize: 28 },
  achieveIconLocked: { opacity: 0.4 },
  achieveLabel: { fontSize: 12, fontWeight: '700', color: COLORS.textPrimary, textAlign: 'center' },
  achieveDesc: { fontSize: 10, color: COLORS.textMuted, textAlign: 'center' },

  favCats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  favCatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  favCatIcon: { fontSize: 14 },
  favCatLabel: { fontSize: 12, fontWeight: '600' },
  favCatCount: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
  },

  savedShortcut: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.accentSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.accentMid,
    padding: 18,
    gap: 12,
  },
  savedShortcutIcon: { fontSize: 22, color: COLORS.accent },
  savedShortcutText: { flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.textPrimary },
  savedShortcutArrow: { fontSize: 18, color: COLORS.accent },

  // Auth
  authCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.accentSoft,
    borderRadius: 16, borderWidth: 1, borderColor: COLORS.accentMid,
    padding: 16,
  },
  authCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  authAvatarCircle: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: COLORS.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  authAvatarIcon: { fontSize: 20 },
  authEmail: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary, maxWidth: 180 },
  authStatus: { fontSize: 11, color: '#4CAF50', fontWeight: '600', marginTop: 2 },
  signOutBtn: {
    backgroundColor: 'rgba(255,100,100,0.15)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(255,100,100,0.3)',
  },
  signOutBtnText: { color: '#FF6B6B', fontWeight: '700', fontSize: 13 },

  loginCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: COLORS.surface,
    borderRadius: 16, borderWidth: 1, borderColor: COLORS.border,
    padding: 16,
  },
  loginCardIcon: { fontSize: 26 },
  loginCardTexts: { flex: 1 },
  loginCardTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  loginCardSub:   { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  loginCardArrow: { fontSize: 20, color: COLORS.accent, fontWeight: '700' },

  submitEventBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: COLORS.surface,
    borderRadius: 16, borderWidth: 1,
    borderColor: COLORS.accentMid,
    padding: 16,
  },
  tiktokInboxBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: COLORS.surface,
    borderRadius: 16, borderWidth: 1,
    borderColor: 'rgba(80,200,160,0.35)',
    padding: 16,
  },
  submitEventIcon:  { fontSize: 26 },
  submitEventTexts: { flex: 1 },
  submitEventTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  submitEventSub:   { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  submitEventArrow: { fontSize: 20, color: COLORS.accent, fontWeight: '700' },
});
