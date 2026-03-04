import 'react-native-url-polyfill/auto';
import React, { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { SavedProvider } from './src/context/SavedContext';
import { EventsProvider } from './src/context/EventsContext';
import { AuthProvider } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import OnboardingScreen, { hasOnboarded } from './src/screens/OnboardingScreen';
import ErrorBoundary from './src/components/ErrorBoundary';
import { COLORS } from './src/constants/colors';

export default function App() {
  const [onboarded, setOnboarded] = useState(null); // null = loading

  useEffect(() => {
    hasOnboarded()
      .then(done => setOnboarded(done))
      .catch(() => setOnboarded(true));
  }, []);

  // Still checking storage
  if (onboarded === null) {
    return <View style={styles.splash} />;
  }

  if (!onboarded) {
    return (
      <ErrorBoundary>
        <OnboardingScreen onDone={() => setOnboarded(true)} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <AuthProvider>
        <EventsProvider>
          <SavedProvider>
            <AppNavigator />
          </SavedProvider>
        </EventsProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: COLORS.bg },
});
