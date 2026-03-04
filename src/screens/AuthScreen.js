import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Animated, ActivityIndicator,
  TouchableWithoutFeedback, Keyboard,
} from 'react-native';
import { COLORS } from '../constants/colors';
import { useAuth } from '../context/AuthContext';

export default function AuthScreen({ onClose }) {
  const { signIn, signUp } = useAuth();
  const [tab, setTab]         = useState('login'); // 'login' | 'register'
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start();
  }, []);

  const switchTab = (t) => {
    setTab(t);
    setError('');
    setSuccess('');
  };

  const handleSubmit = async () => {
    setError('');
    setSuccess('');
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Completează email și parola.');
      return;
    }
    if (password.length < 6) {
      setError('Parola trebuie să aibă minim 6 caractere.');
      return;
    }
    setLoading(true);
    try {
      if (tab === 'login') {
        const { error: err } = await signIn(trimmedEmail, password);
        if (err) { setError(err.message); return; }
        onClose?.();
      } else {
        const { error: err } = await signUp(trimmedEmail, password);
        if (err) { setError(err.message); return; }
        setSuccess('Cont creat! Verifică emailul pentru confirmare.');
        setEmail('');
        setPassword('');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[styles.sheet, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

          {/* Handle */}
          <View style={styles.handle} />

          {/* Close */}
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>

          <Text style={styles.title}>
            {tab === 'login' ? '👋 Bun venit înapoi' : '🚀 Creează cont'}
          </Text>
          <Text style={styles.subtitle}>
            {tab === 'login'
              ? 'Conectează-te la contul tău GOZI'
              : 'Salvează preferințele și lista ta de dorințe'}
          </Text>

          {/* Tab switcher */}
          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tabBtn, tab === 'login' && styles.tabBtnActive]}
              onPress={() => switchTab('login')}
            >
              <Text style={[styles.tabBtnText, tab === 'login' && styles.tabBtnTextActive]}>
                Conectare
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabBtn, tab === 'register' && styles.tabBtnActive]}
              onPress={() => switchTab('register')}
            >
              <Text style={[styles.tabBtnText, tab === 'register' && styles.tabBtnTextActive]}>
                Cont nou
              </Text>
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {/* Email */}
            <View style={styles.inputWrap}>
              <Text style={styles.inputIcon}>✉️</Text>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={COLORS.textMuted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                returnKeyType="next"
              />
            </View>

            {/* Password */}
            <View style={styles.inputWrap}>
              <Text style={styles.inputIcon}>🔒</Text>
              <TextInput
                style={styles.input}
                placeholder="Parolă (min. 6 caractere)"
                placeholderTextColor={COLORS.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </View>

            {/* Error / Success */}
            {!!error   && <Text style={styles.errorText}>⚠️  {error}</Text>}
            {!!success && <Text style={styles.successText}>✅  {success}</Text>}

            {/* Submit */}
            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#000" size="small" />
                : <Text style={styles.submitBtnText}>
                    {tab === 'login' ? 'Conectare →' : 'Creează cont →'}
                  </Text>
              }
            </TouchableOpacity>
          </KeyboardAvoidingView>

          {/* Switch tab link */}
          <TouchableOpacity onPress={() => switchTab(tab === 'login' ? 'register' : 'login')}>
            <Text style={styles.switchText}>
              {tab === 'login' ? 'Nu ai cont? ' : 'Ai deja cont? '}
              <Text style={styles.switchLink}>
                {tab === 'login' ? 'Înregistrează-te' : 'Conectează-te'}
              </Text>
            </Text>
          </TouchableOpacity>

        </Animated.View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'flex-end', zIndex: 999,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 48,
  },
  handle: {
    width: 40, height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  closeBtn: {
    position: 'absolute', top: 20, right: 20,
    width: 32, height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: COLORS.textMuted, fontSize: 14 },

  title: {
    fontSize: 22, fontWeight: '700',
    color: COLORS.text, marginBottom: 4,
  },
  subtitle: {
    fontSize: 13, color: COLORS.textMuted,
    marginBottom: 20,
  },

  tabs: {
    flexDirection: 'row',
    backgroundColor: COLORS.bg,
    borderRadius: 12,
    padding: 3,
    marginBottom: 20,
  },
  tabBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 10,
    alignItems: 'center',
  },
  tabBtnActive: { backgroundColor: COLORS.accent },
  tabBtnText:   { color: COLORS.textMuted, fontWeight: '600', fontSize: 14 },
  tabBtnTextActive: { color: '#000' },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.bg,
    borderRadius: 12, marginBottom: 12,
    paddingHorizontal: 14,
  },
  inputIcon: { fontSize: 16, marginRight: 10 },
  input: {
    flex: 1, height: 48,
    color: COLORS.text, fontSize: 15,
  },

  errorText:   { color: '#FF6B6B', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  successText: { color: '#4CAF50', fontSize: 13, marginBottom: 12, textAlign: 'center' },

  submitBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 14, height: 50,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#000', fontWeight: '700', fontSize: 16 },

  switchText: {
    textAlign: 'center', color: COLORS.textMuted, fontSize: 13,
  },
  switchLink: {
    color: COLORS.accent, fontWeight: '600',
  },
});
