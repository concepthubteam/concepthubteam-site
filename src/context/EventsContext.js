import React, { createContext, useContext, useState, useEffect } from 'react';
import { EVENTS as MOCK_EVENTS } from '../data/mockData';
import { supabase, isConfigured } from '../lib/supabase';

const EventsContext = createContext();

export function EventsProvider({ children }) {
  const [events, setEvents] = useState(MOCK_EVENTS);
  const [loading, setLoading] = useState(isConfigured);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isConfigured) return;

    let subscription;

    async function fetchEvents() {
      try {
        const { data, error: err } = await supabase
          .from('events')
          .select('*')
          .order('date_iso', { ascending: true, nullsFirst: false });

        if (err) throw err;
        if (data && data.length > 0) {
          setEvents(data);
        }
      } catch (e) {
        setError(e.message);
        // keep MOCK_EVENTS as fallback
      } finally {
        setLoading(false);
      }
    }

    fetchEvents();

    // Real-time subscription for live updates
    subscription = supabase
      .channel('events-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => {
        fetchEvents();
      })
      .subscribe();

    return () => {
      if (subscription) supabase.removeChannel(subscription);
    };
  }, []);

  return (
    <EventsContext.Provider value={{ events, loading, error }}>
      {children}
    </EventsContext.Provider>
  );
}

export function useEvents() {
  return useContext(EventsContext);
}
