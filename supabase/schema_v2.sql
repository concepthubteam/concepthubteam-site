-- ============================================================
-- GOZI v2 Schema Migration
-- Run AFTER schema.sql (events + user_saved already exist)
-- Supabase SQL Editor > paste > Run
-- ============================================================

-- 0. Helper: ensure updated_at trigger function exists
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 1. VENUES
-- ============================================================
CREATE TABLE IF NOT EXISTS venues (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  name_normalized      TEXT,
  address              TEXT,
  city                 TEXT DEFAULT 'Bucharest',
  lat                  NUMERIC(9,6),
  lng                  NUMERIC(9,6),
  google_place_id      TEXT,
  website              TEXT,
  instagram            TEXT,
  facebook             TEXT,
  website_crawled_at   TIMESTAMPTZ,      -- last time venue_cron crawled this website
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_name_norm
  ON venues(name_normalized) WHERE name_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_venues_google_place
  ON venues(google_place_id) WHERE google_place_id IS NOT NULL;

DROP TRIGGER IF EXISTS venues_updated_at ON venues;
CREATE TRIGGER venues_updated_at
  BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 2. EXTEND EVENTS TABLE (preserve existing 92 rows)
-- ============================================================
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS hash_key        TEXT,
  ADD COLUMN IF NOT EXISTS title_normalized TEXT,
  ADD COLUMN IF NOT EXISTS venue_id        UUID REFERENCES venues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS venue_name_raw  TEXT,
  ADD COLUMN IF NOT EXISTS address_raw     TEXT,
  ADD COLUMN IF NOT EXISTS start_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS all_day         BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_min       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS price_max       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS currency        TEXT DEFAULT 'RON',
  ADD COLUMN IF NOT EXISTS is_free         BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ticket_url      TEXT,
  ADD COLUMN IF NOT EXISTS image_url       TEXT,
  ADD COLUMN IF NOT EXISTS images          JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS source_best     TEXT,
  ADD COLUMN IF NOT EXISTS status          TEXT DEFAULT 'published';

-- Populate new columns from existing data
UPDATE events SET
  start_at   = (date_iso || ' ' || COALESCE(time, '00:00') || ':00+02:00')::TIMESTAMPTZ
WHERE date_iso IS NOT NULL AND start_at IS NULL;

UPDATE events SET image_url  = image      WHERE image_url  IS NULL AND image       IS NOT NULL;
UPDATE events SET ticket_url = tickets_url WHERE ticket_url IS NULL AND tickets_url IS NOT NULL;
UPDATE events SET is_free     = (price = 'Gratuit' OR price = '0 RON') WHERE is_free IS FALSE;

-- Parse price into min/max for existing rows
UPDATE events SET
  price_min = CASE
    WHEN price ~ '^\d+' THEN SPLIT_PART(regexp_replace(price, '[^0-9\-]', '', 'g'), '-', 1)::NUMERIC
    ELSE NULL END,
  price_max = CASE
    WHEN price ~ '\d+-\d+' THEN SPLIT_PART(regexp_replace(price, '[^0-9\-]', '', 'g'), '-', 2)::NUMERIC
    WHEN price ~ '^\d+' THEN SPLIT_PART(regexp_replace(price, '[^0-9\-]', '', 'g'), '-', 1)::NUMERIC
    ELSE NULL END
WHERE price IS NOT NULL AND price != 'Gratuit' AND price_min IS NULL;

-- Unique constraint on hash_key (nullable OK — only new ingested rows will have it)
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_hash_key  ON events(hash_key) WHERE hash_key IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_events_start_at  ON events(start_at);
CREATE INDEX        IF NOT EXISTS idx_events_venue_id  ON events(venue_id);
CREATE INDEX        IF NOT EXISTS idx_events_status    ON events(status);
CREATE INDEX        IF NOT EXISTS idx_events_is_free   ON events(is_free);


-- ============================================================
-- 3. SOURCE_EVENTS (provenance / raw ingestion log)
-- ============================================================
CREATE TABLE IF NOT EXISTS source_events (
  id                  SERIAL PRIMARY KEY,
  source              TEXT NOT NULL,
  source_event_id     TEXT NOT NULL,
  url                 TEXT,
  fetched_at          TIMESTAMPTZ DEFAULT NOW(),
  payload             JSONB,
  title_raw           TEXT,
  venue_raw           TEXT,
  start_at_raw        TEXT,
  canonical_event_id  INT  REFERENCES events(id) ON DELETE SET NULL,
  canonical_venue_id  UUID REFERENCES venues(id) ON DELETE SET NULL,
  match_confidence    NUMERIC(5,4),
  match_method        TEXT,    -- 'hash_key' | 'fuzzy' | 'new'
  UNIQUE(source, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_src_canonical ON source_events(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_src_source    ON source_events(source, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_src_method    ON source_events(match_method);


-- ============================================================
-- 4. USER_SAVED — already exists; add index if missing
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_user_saved_user ON user_saved(user_id);


-- ============================================================
-- 5. EVENT_SUBMISSIONS — replace with JSONB payload version
-- ============================================================
DROP TABLE IF EXISTS event_submissions CASCADE;

CREATE TABLE event_submissions (
  id           SERIAL PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payload      JSONB NOT NULL,
  status       TEXT DEFAULT 'pending',  -- pending | approved | rejected
  reviewer_id  UUID REFERENCES auth.users(id),
  notes        TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at  TIMESTAMPTZ
);

ALTER TABLE event_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "submissions: insert"   ON event_submissions FOR INSERT WITH CHECK (true);
CREATE POLICY "submissions: own read" ON event_submissions FOR SELECT USING (auth.uid() = user_id);


-- ============================================================
-- 6. USEFUL VIEWS
-- ============================================================

-- Upcoming public events (used by app)
CREATE OR REPLACE VIEW v_upcoming_events AS
SELECT * FROM events
WHERE status = 'published'
  AND (start_at >= NOW() OR date_iso IS NULL)
ORDER BY
  CASE WHEN featured THEN 0 ELSE 1 END,
  start_at ASC NULLS LAST;

-- Dedupe audit: events with multiple source_events
CREATE OR REPLACE VIEW v_dedupe_audit AS
SELECT
  e.id,
  e.title,
  e.start_at,
  COUNT(se.id) AS source_count,
  ARRAY_AGG(DISTINCT se.source) AS sources,
  ARRAY_AGG(se.match_method) AS methods
FROM events e
JOIN source_events se ON se.canonical_event_id = e.id
GROUP BY e.id, e.title, e.start_at
HAVING COUNT(se.id) > 1;


-- ============================================================
-- Done. Verify with:
--   SELECT COUNT(*) FROM events;
--   SELECT COUNT(*) FROM venues;
--   SELECT COUNT(*) FROM source_events;
-- ============================================================
