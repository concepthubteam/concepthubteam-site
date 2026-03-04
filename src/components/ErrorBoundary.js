import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { COLORS } from '../constants/colors';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Log to console in dev; replace with Sentry/LogRocket in prod
    if (__DEV__) {
      console.error('[GOZI ErrorBoundary]', error.message, info.componentStack);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>⚠️</Text>
        <Text style={styles.title}>Ceva n-a mers bine</Text>
        <Text style={styles.subtitle}>
          Aplicația a întâmpinat o problemă neașteptată.
        </Text>

        {__DEV__ && this.state.error && (
          <ScrollView style={styles.errorBox} horizontal={false}>
            <Text style={styles.errorText} selectable>
              {this.state.error.toString()}
            </Text>
          </ScrollView>
        )}

        <TouchableOpacity style={styles.btn} onPress={this.handleRetry} activeOpacity={0.85}>
          <Text style={styles.btnText}>Încearcă din nou</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emoji:    { fontSize: 52, marginBottom: 16 },
  title:    { fontSize: 22, fontWeight: '800', color: COLORS.text || '#F5F0EB', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 14, color: COLORS.textMuted || '#6B6057', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  errorBox: {
    backgroundColor: '#1a0000',
    borderRadius: 10,
    padding: 12,
    marginBottom: 24,
    maxHeight: 160,
    width: '100%',
  },
  errorText: { color: '#FF6B6B', fontSize: 11, fontFamily: 'monospace' },
  btn: {
    backgroundColor: COLORS.accent || '#FF7334',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 22,
  },
  btnText: { color: '#000', fontWeight: '800', fontSize: 15 },
});
