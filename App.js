import 'react-native-url-polyfill/auto';
import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { SavedProvider } from './src/context/SavedContext';
import { EventsProvider } from './src/context/EventsContext';
import { AuthProvider } from './src/context/AuthContext';
import { CityPulseProvider } from './src/context/CityPulseContext';
import AppNavigator, { navigationRef } from './src/navigation/AppNavigator';
import OnboardingScreen, { hasOnboarded } from './src/screens/OnboardingScreen';
import ErrorBoundary from './src/components/ErrorBoundary';
import { COLORS } from './src/constants/colors';

export default function App() {
  const [onboarded, setOnboarded] = useState(null); // null = loading
  const responseListener = useRef();

  // ── Setup notificări (canal Android + listener tap) ──────────────────────
  useEffect(() => {
    // Android: crează canal cu prioritate HIGH (required pentru Android 8+)
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('gozi_reminders', {
        name: 'Remindere GOZI',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF7334',
        sound: 'default',
      });
    }

    // Listener: user tapează notificarea când app-ul e deschis sau în background
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const eventId = response.notification.request.content.data?.eventId;
      if (!eventId) return;
      if (navigationRef.isReady()) {
        navigationRef.navigate('EventDetail', { eventId: String(eventId) });
      } else {
        // Navigator nu e gata — așteptăm
        const interval = setInterval(() => {
          if (navigationRef.isReady()) {
            clearInterval(interval);
            navigationRef.navigate('EventDetail', { eventId: String(eventId) });
          }
        }, 100);
        setTimeout(() => clearInterval(interval), 5000);
      }
    });

    // Cold start: app ucis, user tapează notificarea → o prinde la restart
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!response) return;
      const eventId = response.notification.request.content.data?.eventId;
      if (!eventId) return;
      const interval = setInterval(() => {
        if (navigationRef.isReady()) {
          clearInterval(interval);
          navigationRef.navigate('EventDetail', { eventId: String(eventId) });
        }
      }, 100);
      setTimeout(() => clearInterval(interval), 8000);
    });

    return () => {
      responseListener.current?.remove();
    };
  }, []);

  // ── Check onboarding ──────────────────────────────────────────────────────
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
          <CityPulseProvider>
            <SavedProvider>
              <AppNavigator />
            </SavedProvider>
          </CityPulseProvider>
        </EventsProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: COLORS.bg },
});
