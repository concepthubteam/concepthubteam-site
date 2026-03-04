import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import { useSaved } from '../context/SavedContext';

// Deep link config — gozi://event/5 → EventDetail cu eventId=5
const linking = {
  prefixes: ['gozi://', 'https://gozi.app'],
  config: {
    screens: {
      MainTabs: {
        screens: {
          Home:    'home',
          Explore: 'explore',
          Map:     'map',
          Saved:   'saved',
          Profile: 'profile',
        },
      },
      EventDetail: 'event/:eventId',
    },
  },
};

import HomeScreen         from '../screens/HomeScreen';
import MapScreen          from '../screens/MapScreen';
import ExploreScreen      from '../screens/ExploreScreen';
import SavedScreen        from '../screens/SavedScreen';
import ProfileScreen      from '../screens/ProfileScreen';
import EventDetailScreen  from '../screens/EventDetailScreen';
import SubmitEventScreen  from '../screens/SubmitEventScreen';
import TikTokInboxScreen  from '../screens/TikTokInboxScreen';

const Tab   = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabIcon({ focused, name, nameActive, label, color, badge }) {
  return (
    <View style={styles.tabItem}>
      <View>
        <Ionicons
          name={focused ? nameActive : name}
          size={22}
          color={focused ? color : COLORS.textMuted}
        />
        {badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.tabLabel, { color: focused ? color : COLORS.textMuted }]}>
        {label}
      </Text>
    </View>
  );
}

function MainTabs() {
  const { savedIds } = useSaved();
  const savedCount = savedIds.size;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: false,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} name="home-outline" nameActive="home" label="Acasă" color={COLORS.accent} />
          ),
        }}
      />
      <Tab.Screen
        name="Explore"
        component={ExploreScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} name="search-outline" nameActive="search" label="Explorează" color={COLORS.accent} />
          ),
        }}
      />
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} name="map-outline" nameActive="map" label="Hartă" color={COLORS.accent} />
          ),
        }}
      />
      <Tab.Screen
        name="Saved"
        component={SavedScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon
              focused={focused}
              name="heart-outline"
              nameActive="heart"
              label="Salvate"
              color={COLORS.accent}
              badge={savedCount}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} name="person-outline" nameActive="person" label="Profil" color={COLORS.accent} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <NavigationContainer
      linking={linking}
      theme={{
        dark: true,
        colors: {
          primary: COLORS.accent,
          background: COLORS.bg,
          card: COLORS.surface,
          text: COLORS.textPrimary,
          border: COLORS.border,
          notification: COLORS.accent,
        },
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen
          name="EventDetail"
          component={EventDetailScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="SubmitEvent"
          component={SubmitEventScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="TikTokInbox"
          component={TikTokInboxScreen}
          options={{ animation: 'slide_from_right' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    height: 76,
    paddingBottom: 10,
    paddingTop: 8,
  },
  tabItem: { alignItems: 'center', gap: 3 },
  tabLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 0.4 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: COLORS.accent,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
});
