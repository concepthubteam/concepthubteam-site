import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, StatusBar, ScrollView, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { COLORS } from '../constants/colors';
import { useAuth } from '../context/AuthContext';
import { supabase, isConfigured } from '../lib/supabase';

const CATEGORIES = [
  { id: 'events',      label: '🎉 Eveniment' },
  { id: 'restaurants', label: '🍽️ Restaurant' },
  { id: 'clubs',       label: '🎶 Club/Concert' },
  { id: 'theatre',     label: '🎭 Teatru' },
  { id: 'cinema',      label: '🎬 Cinema' },
  { id: 'sport',       label: '🏋️ Sport' },
  { id: 'kids',        label: '👶 Copii' },
  { id: 'parks',       label: '🌳 Parc/Natură' },
];

const EMPTY = {
  title:       '',
  category:    'events',
  date_text:   '',
  venue:       '',
  address:     '',
  price:       '',
  description: '',
  website:     '',
  phone:       '',
  instagram:   '',
};

export default function SubmitEventScreen({ navigation }) {
  const { user } = useAuth();
  const [form,    setForm]    = useState(EMPTY);
  const [loading, setLoading] = useState(false);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const validate = () => {
    if (!form.title.trim())    { Alert.alert('Lipsă', 'Titlul este obligatoriu.'); return false; }
    if (!form.venue.trim())    { Alert.alert('Lipsă', 'Locația este obligatorie.'); return false; }
    if (form.title.length < 3) { Alert.alert('Titlu prea scurt', 'Minim 3 caractere.'); return false; }
    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    if (!isConfigured) {
      Alert.alert(
        'Backend neconectat',
        'Supabase nu este configurat. Completează .env cu keys-urile tale pentru a trimite evenimente.',
        [{ text: 'OK' }]
      );
      return;
    }

    setLoading(true);
    try {
      const row = {
        ...form,
        user_id:     user?.id ?? null,
        title:       form.title.trim(),
        venue:       form.venue.trim(),
        address:     form.address.trim() || 'București',
        price:       form.price.trim()   || 'Gratuit',
        description: form.description.trim(),
        status:      'pending',
      };

      const { error } = await supabase.from('event_submissions').insert(row);

      if (error) throw error;

      Alert.alert(
        '✅ Trimis!',
        'Evenimentul tău a fost trimis și va fi revizuit în curând. Mulțumim!',
        [{ text: 'Super!', onPress: () => navigation.goBack() }]
      );
      setForm(EMPTY);
    } catch (e) {
      Alert.alert('Eroare', e.message || 'Nu s-a putut trimite. Încearcă din nou.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Adaugă Eveniment</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.intro}>
            Știi de un eveniment mișto în București? Spune-ne! Îl verificăm și îl adăugăm în GOZI.
          </Text>

          {/* Titlu */}
          <Field label="Titlu *" required>
            <Input
              placeholder="ex: Concert Voltaj la Sala Palatului"
              value={form.title}
              onChangeText={v => set('title', v)}
              maxLength={120}
            />
          </Field>

          {/* Categorie */}
          <Field label="Categorie *">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
              {CATEGORIES.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.catChip, form.category === c.id && styles.catChipActive]}
                  onPress={() => set('category', c.id)}
                >
                  <Text style={[styles.catChipText, form.category === c.id && styles.catChipTextActive]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Field>

          {/* Dată */}
          <Field label="Dată">
            <Input
              placeholder="ex: 15 Aprilie 2026 sau Oricând"
              value={form.date_text}
              onChangeText={v => set('date_text', v)}
            />
          </Field>

          {/* Locație */}
          <Field label="Locație / Venue *" required>
            <Input
              placeholder="ex: Sala Palatului, Club Control"
              value={form.venue}
              onChangeText={v => set('venue', v)}
            />
          </Field>

          {/* Adresă */}
          <Field label="Adresă">
            <Input
              placeholder="ex: Str. Ion Câmpineanu 28"
              value={form.address}
              onChangeText={v => set('address', v)}
            />
          </Field>

          {/* Preț */}
          <Field label="Preț">
            <Input
              placeholder="ex: Gratuit / 80 RON / 50–120 RON"
              value={form.price}
              onChangeText={v => set('price', v)}
            />
          </Field>

          {/* Descriere */}
          <Field label="Descriere scurtă">
            <Input
              placeholder="Câteva cuvinte despre eveniment..."
              value={form.description}
              onChangeText={v => set('description', v)}
              multiline
              numberOfLines={3}
              style={{ minHeight: 80, textAlignVertical: 'top' }}
              maxLength={500}
            />
          </Field>

          {/* Website */}
          <Field label="Website / Link bilete">
            <Input
              placeholder="https://..."
              value={form.website}
              onChangeText={v => set('website', v)}
              keyboardType="url"
              autoCapitalize="none"
            />
          </Field>

          {/* Telefon */}
          <Field label="Telefon">
            <Input
              placeholder="+40 7xx xxx xxx"
              value={form.phone}
              onChangeText={v => set('phone', v)}
              keyboardType="phone-pad"
            />
          </Field>

          {/* Instagram */}
          <Field label="Instagram">
            <Input
              placeholder="@handle"
              value={form.instagram}
              onChangeText={v => set('instagram', v)}
              autoCapitalize="none"
            />
          </Field>

          <Text style={styles.note}>
            * Câmpuri obligatorii. Evenimentul va fi revizuit înainte de publicare.
          </Text>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={styles.submitBtnText}>📤  Trimite evenimentul</Text>
            }
          </TouchableOpacity>

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Input({ style, ...props }) {
  return (
    <TextInput
      style={[styles.input, style]}
      placeholderTextColor={COLORS.textMuted}
      selectionColor={COLORS.accent}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn:       { width: 36, height: 36, justifyContent: 'center' },
  backBtnText:   { color: COLORS.accent, fontSize: 22 },
  headerTitle:   { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: COLORS.text || '#F5F0EB' },
  headerSpacer:  { width: 36 },

  scroll: { padding: 20 },

  intro: {
    fontSize: 13, color: COLORS.textMuted,
    lineHeight: 20, marginBottom: 24,
    backgroundColor: COLORS.surface,
    borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: COLORS.border,
  },

  field:      { marginBottom: 18 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted, marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' },

  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: COLORS.text || '#F5F0EB',
  },

  catScroll: { marginHorizontal: -4 },
  catChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
    backgroundColor: COLORS.surface,
  },
  catChipActive:     { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  catChipText:       { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  catChipTextActive: { color: '#000' },

  note: {
    fontSize: 11, color: COLORS.textMuted,
    marginBottom: 20, textAlign: 'center',
  },

  submitBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 16, height: 54,
    alignItems: 'center', justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText:     { color: '#000', fontWeight: '800', fontSize: 16 },
});
