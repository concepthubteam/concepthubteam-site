import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { supabase, isConfigured } from '../lib/supabase';

const CityPulseContext = createContext();

const OPT_IN_KEY        = '@gozi:cityPulseOptIn';
const ANON_HASH_KEY     = '@gozi:anonHash';
const LAST_GPS_PING_KEY = '@gozi:lastGpsPing'; // { venueId: timestamp }
const GPS_COOLDOWN_MS   = 5 * 60 * 1000;  // 5 minute intre ping-uri per venue
const NEARBY_RADIUS_M   = 150;             // raza detectie GPS (150m)
const REFRESH_INTERVAL  = 45 * 1000;      // refresh heat cache la 45s

// ── Haversine (metri) ────────────────────────────────────────────────────────
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
          * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Hash anonim zilnic ───────────────────────────────────────────────────────
// Genereaza un ID persistent per instalare + salt zilnic
// => imposibil de corelat cu utilizatorul, se schimba in fiecare zi
async function getOrCreateAnonHash() {
  let raw = await AsyncStorage.getItem(ANON_HASH_KEY);
  if (!raw) {
    raw = Math.random().toString(36).slice(2) + Date.now().toString(36);
    await AsyncStorage.setItem(ANON_HASH_KEY, raw);
  }
  const today = new Date().toISOString().split('T')[0];
  // XOR simplu: raw + data zilei => hash diferit in fiecare zi
  const combined = raw + ':' + today;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash + combined.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).padStart(8, '0');
}

// ─────────────────────────────────────────────────────────────────────────────
export function CityPulseProvider({ children }) {
  const [optedIn, setOptedIn]       = useState(false);
  const [heatData, setHeatData]     = useState([]);   // venue_heat_cache rows
  const [loading, setLoading]       = useState(true);
  const [anonHash, setAnonHash]     = useState(null);
  const intervalRef = useRef(null);
  const subscriptionRef = useRef(null);

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [pref, hash] = await Promise.all([
        AsyncStorage.getItem(OPT_IN_KEY),
        getOrCreateAnonHash(),
      ]);
      setOptedIn(pref === 'true');
      setAnonHash(hash);
    })();
  }, []);

  // ── Fetch heat cache ───────────────────────────────────────────────────────
  const fetchHeatData = useCallback(async () => {
    if (!isConfigured) { setLoading(false); return; }
    try {
      const { data, error } = await supabase
        .from('venue_heat_cache')
        .select('*')
        .order('heat_score', { ascending: false });
      if (!error && data) setHeatData(data);
    } catch (_) {}
    finally { setLoading(false); }
  }, []);

  // ── Polling + Realtime ─────────────────────────────────────────────────────
  useEffect(() => {
    fetchHeatData();

    // Polling la 45s
    intervalRef.current = setInterval(fetchHeatData, REFRESH_INTERVAL);

    // Realtime pe venue_heat_cache
    if (isConfigured) {
      subscriptionRef.current = supabase
        .channel('city-pulse-heat')
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'venue_heat_cache' },
          () => fetchHeatData()
        )
        .subscribe();
    }

    return () => {
      clearInterval(intervalRef.current);
      if (subscriptionRef.current) supabase.removeChannel(subscriptionRef.current);
    };
  }, [fetchHeatData]);

  // ── Log presence (fire & forget, cu cooldown) ──────────────────────────────
  const logPresence = useCallback(async (venueId, source) => {
    if (!isConfigured || !anonHash) return;

    // Cooldown per venue (GPS only)
    if (source === 'gps_open') {
      const raw = await AsyncStorage.getItem(LAST_GPS_PING_KEY);
      const lastPings = raw ? JSON.parse(raw) : {};
      const lastPing = lastPings[venueId] || 0;
      if (Date.now() - lastPing < GPS_COOLDOWN_MS) return;
      lastPings[venueId] = Date.now();
      await AsyncStorage.setItem(LAST_GPS_PING_KEY, JSON.stringify(lastPings));
    }

    // Fire & forget — nu blocheaza UI
    supabase.rpc('log_venue_presence', {
      p_venue_id:  venueId,
      p_user_hash: anonHash,
      p_source:    source,
    }).then(() => {}).catch(() => {});
  }, [anonHash]);

  // ── GPS proximity check (la deschiderea app-ului, doar daca opt-in) ────────
  const checkGpsProximity = useCallback(async (knownVenues) => {
    if (!optedIn || !anonHash || !knownVenues?.length) return;

    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      knownVenues.forEach(venue => {
        if (!venue.lat || !venue.lng) return;
        const dist = distanceMeters(
          loc.coords.latitude, loc.coords.longitude,
          Number(venue.lat), Number(venue.lng)
        );
        if (dist <= NEARBY_RADIUS_M) {
          logPresence(venue.venue_id, 'gps_open');
        }
      });
    } catch (_) {}
  }, [optedIn, anonHash, logPresence]);

  // ── Check-in explicit ──────────────────────────────────────────────────────
  const checkIn = useCallback(async (venueId) => {
    await logPresence(venueId, 'checkin');
    // Refresh imediat dupa check-in pentru UX responsiv
    setTimeout(fetchHeatData, 800);
  }, [logPresence, fetchHeatData]);

  // ── Toggle opt-in ──────────────────────────────────────────────────────────
  const setOptIn = useCallback(async (value) => {
    setOptedIn(value);
    await AsyncStorage.setItem(OPT_IN_KEY, value ? 'true' : 'false');
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const getVenueHeat = useCallback((venueId) => {
    return heatData.find(h => h.venue_id === venueId) || null;
  }, [heatData]);

  const getNearbyHeat = useCallback((userLocation, radiusKm = 2) => {
    if (!userLocation) return heatData;
    return heatData.filter(v => {
      if (!v.venue_lat || !v.venue_lng) return false;
      const dist = distanceMeters(
        userLocation.latitude, userLocation.longitude,
        Number(v.venue_lat), Number(v.venue_lng)
      );
      return dist <= radiusKm * 1000;
    }).sort((a, b) => b.heat_score - a.heat_score);
  }, [heatData]);

  return (
    <CityPulseContext.Provider value={{
      optedIn, setOptIn,
      heatData, loading,
      logPresence, checkIn,
      checkGpsProximity,
      getVenueHeat,
      getNearbyHeat,
      refresh: fetchHeatData,
    }}>
      {children}
    </CityPulseContext.Provider>
  );
}

export function useCityPulse() {
  return useContext(CityPulseContext);
}

export { distanceMeters };
