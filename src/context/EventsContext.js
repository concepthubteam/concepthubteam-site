import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { EVENTS as MOCK_EVENTS } from '../data/mockData';
import { supabase, isConfigured } from '../lib/supabase';

const EventsContext = createContext();

const PAGE_SIZE = 100; // events per Supabase request

// Normalizează un event din DB (snake_case) la formatul așteptat de UI (camelCase)
function normalizeEvent(e) {
  return {
    ...e,
    dateISO:       e.dateISO       ?? e.date_iso    ?? null,
    ticketsUrl:    e.ticketsUrl    ?? e.tickets_url  ?? e.ticket_url ?? null,
    image:         e.image         ?? e.image_url    ?? null,
    categoryLabel: e.categoryLabel ?? e.category_label ?? e.category ?? '',
    tags:          Array.isArray(e.tags) ? e.tags : [],
    price:         e.price         ?? 'N/A',
    rating:        e.rating        ?? 0,
    distance:      e.distance      ?? '',
    timeEnd:       e.timeEnd       ?? e.time_end     ?? '',
    venue:         e.venue         ?? e.venue_name_raw ?? '',
    lat:           Number(e.lat)   || 44.4368,
    lng:           Number(e.lng)   || 26.0976,
    savedCount:    e.savedCount    ?? e.saved_count    ?? 0,
    ticketClicks:  e.ticketClicks  ?? e.ticket_clicks  ?? 0,
  };
}

export function EventsProvider({ children }) {
  const [events,      setEvents]      = useState(MOCK_EVENTS.map(normalizeEvent));
  const [loading,     setLoading]     = useState(isConfigured);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,       setError]       = useState(null);

  // Ref pentru savedCounts — nu declanșează re-render la actualizare în background
  const savedCountsRef = useRef({});

  useEffect(() => {
    if (!isConfigured) return;

    let subscription;
    let cancelled = false;

    async function fetchAllPages() {
      try {
        // Prima pagina + saved counts în parallel → render rapid
        const [firstResult, savedResult] = await Promise.all([
          supabase
            .from('events')
            .select('*')
            .order('date_iso', { ascending: true, nullsFirst: false })
            .range(0, PAGE_SIZE - 1),
          supabase.from('user_saved').select('event_id'),
        ]);

        if (firstResult.error) throw firstResult.error;

        // Map: event_id → count de save-uri
        const savedCounts = {};
        (savedResult.data || []).forEach(row => {
          savedCounts[row.event_id] = (savedCounts[row.event_id] || 0) + 1;
        });
        savedCountsRef.current = savedCounts;

        if (cancelled) return;

        const firstPage = (firstResult.data || []).map(e =>
          normalizeEvent({ ...e, saved_count: savedCounts[e.id] || 0 })
        );

        if (firstPage.length > 0) setEvents(firstPage);
        setLoading(false);

        // Dacă prima pagină e plină → mai există date, le încarcăm în background
        if ((firstResult.data || []).length === PAGE_SIZE) {
          setLoadingMore(true);
          let page = 1;
          let accumulated = [...firstPage];

          while (!cancelled) {
            const result = await supabase
              .from('events')
              .select('*')
              .order('date_iso', { ascending: true, nullsFirst: false })
              .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

            if (result.error || !result.data || result.data.length === 0) break;

            const normalized = result.data.map(e =>
              normalizeEvent({ ...e, saved_count: savedCountsRef.current[e.id] || 0 })
            );

            accumulated = [...accumulated, ...normalized];
            if (!cancelled) setEvents([...accumulated]);

            if (result.data.length < PAGE_SIZE) break; // ultima pagina
            page++;
          }

          if (!cancelled) setLoadingMore(false);
        }
      } catch (e) {
        setError(e.message);
        setLoading(false);
        setLoadingMore(false);
        // MOCK_EVENTS rămâne fallback
      }
    }

    fetchAllPages();

    // Real-time subscription pentru updates live
    subscription = supabase
      .channel('events-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => {
        fetchAllPages();
      })
      .subscribe();

    return () => {
      cancelled = true;
      if (subscription) supabase.removeChannel(subscription);
    };
  }, []);

  return (
    <EventsContext.Provider value={{ events, loading, loadingMore, error }}>
      {children}
    </EventsContext.Provider>
  );
}

export function useEvents() {
  return useContext(EventsContext);
}
