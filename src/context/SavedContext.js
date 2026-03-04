import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isConfigured } from '../lib/supabase';
import { useAuth } from './AuthContext';

const STORAGE_KEY = '@gozi:saved_ids';
const SavedContext = createContext();

export function SavedProvider({ children }) {
  const { user } = useAuth();
  const [savedIds, setSavedIds] = useState(new Set());
  const [loaded, setLoaded]     = useState(false);
  const prevUserRef = useRef(null);

  // ── 1. Load: AsyncStorage first (instant), then cloud if logged in ──
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(json => {
        if (json) setSavedIds(new Set(JSON.parse(json)));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // ── 2. When user logs in: merge local + cloud ──
  useEffect(() => {
    const prevUser = prevUserRef.current;
    prevUserRef.current = user;

    if (!user || !isConfigured) return;
    if (prevUser?.id === user.id) return; // same session, no re-sync needed

    async function syncOnLogin() {
      try {
        // Fetch cloud saved
        const { data, error } = await supabase
          .from('user_saved')
          .select('event_id')
          .eq('user_id', user.id);

        if (error) return;

        const cloudIds = new Set((data || []).map(r => r.event_id));

        // Merge: local ∪ cloud
        setSavedIds(prev => {
          const merged = new Set([...prev, ...cloudIds]);

          // Upload any local IDs that aren't in cloud yet
          const toUpload = [...prev].filter(id => !cloudIds.has(id));
          if (toUpload.length > 0) {
            supabase.from('user_saved').insert(
              toUpload.map(id => ({ user_id: user.id, event_id: id }))
            ).then(() => {});
          }

          // Persist merged locally
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...merged])).catch(() => {});
          return merged;
        });
      } catch (_) {}
    }

    syncOnLogin();
  }, [user]);

  // ── 3. Persist locally on every change ──
  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...savedIds])).catch(() => {});
  }, [savedIds, loaded]);

  // ── 4. Toggle: update local + cloud in parallel ──
  const toggleSaved = useCallback((eventId) => {
    setSavedIds(prev => {
      const next = new Set(prev);
      const adding = !next.has(eventId);

      if (adding) {
        next.add(eventId);
      } else {
        next.delete(eventId);
      }

      // Fire-and-forget cloud sync if logged in
      if (user && isConfigured) {
        if (adding) {
          supabase.from('user_saved')
            .insert({ user_id: user.id, event_id: eventId })
            .then(() => {});
        } else {
          supabase.from('user_saved')
            .delete()
            .eq('user_id', user.id)
            .eq('event_id', eventId)
            .then(() => {});
        }
      }

      return next;
    });
  }, [user]);

  const clearSaved = useCallback(() => {
    setSavedIds(new Set());
    if (user && isConfigured) {
      supabase.from('user_saved').delete().eq('user_id', user.id).then(() => {});
    }
  }, [user]);

  const isSaved = useCallback((eventId) => savedIds.has(eventId), [savedIds]);

  return (
    <SavedContext.Provider value={{ savedIds, toggleSaved, isSaved, clearSaved, loaded }}>
      {children}
    </SavedContext.Provider>
  );
}

export function useSaved() {
  return useContext(SavedContext);
}
