-- GOZI Events table
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New query)

CREATE TABLE IF NOT EXISTS events (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL,
  category_label TEXT,
  date          TEXT,
  date_iso      DATE,
  time          TEXT,
  time_end      TEXT,
  venue         TEXT,
  address       TEXT,
  price         TEXT DEFAULT 'Gratuit',
  rating        NUMERIC(2,1) DEFAULT 4.0,
  distance      TEXT,
  description   TEXT,
  lat           NUMERIC(9,6),
  lng           NUMERIC(9,6),
  featured      BOOLEAN DEFAULT false,
  tags          TEXT[] DEFAULT '{}',
  website       TEXT,
  phone         TEXT,
  tickets_url   TEXT,
  instagram     TEXT,
  image         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (Row Level Security) — read-only for anon
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON events
  FOR SELECT USING (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE events;

-- Useful indexes
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
CREATE INDEX IF NOT EXISTS idx_events_date_iso ON events(date_iso);
CREATE INDEX IF NOT EXISTS idx_events_featured ON events(featured);

-- ─────────────────────────────────────────────────────────────────
-- USER SAVED EVENTS — synced per authenticated user
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_saved (
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id  INT  NOT NULL REFERENCES events(id)     ON DELETE CASCADE,
  saved_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, event_id)
);

ALTER TABLE user_saved ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own saved rows
CREATE POLICY "user_saved: own read"   ON user_saved FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_saved: own insert" ON user_saved FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_saved: own delete" ON user_saved FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_saved_user ON user_saved(user_id);

-- ─────────────────────────────────────────────────────────────────
-- EVENT SUBMISSIONS — user-submitted events (pending review)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_submissions (
  id          SERIAL PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,
  date_text   TEXT,
  venue       TEXT,
  address     TEXT,
  price       TEXT DEFAULT 'Gratuit',
  description TEXT,
  website     TEXT,
  phone       TEXT,
  instagram   TEXT,
  status      TEXT DEFAULT 'pending',  -- pending | approved | rejected
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE event_submissions ENABLE ROW LEVEL SECURITY;

-- Anyone (even anon) can submit; only the owner can read their submissions
CREATE POLICY "submissions: insert"    ON event_submissions FOR INSERT WITH CHECK (true);
CREATE POLICY "submissions: own read"  ON event_submissions FOR SELECT USING (auth.uid() = user_id);
