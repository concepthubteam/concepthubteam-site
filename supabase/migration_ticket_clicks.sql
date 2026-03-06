-- Migration: adaugă coloana ticket_clicks pe tabelul events
-- Rulează în Supabase Dashboard → SQL Editor

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS ticket_clicks INT DEFAULT 0;

-- Index opțional pentru sortare după popularitate
CREATE INDEX IF NOT EXISTS idx_events_ticket_clicks ON events(ticket_clicks DESC);

-- Verificare
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'events' AND column_name = 'ticket_clicks';
