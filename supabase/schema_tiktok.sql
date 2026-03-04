-- ============================================================
-- GOZI — TikTok Integration Schema
-- Paste in Supabase SQL Editor > Run
-- Requires schema_v2.sql to have been run first (venues table)
-- ============================================================

-- ============================================================
-- 1. TIKTOK_ACCOUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS tiktok_accounts (
  id               SERIAL PRIMARY KEY,
  username         TEXT NOT NULL UNIQUE,
  url              TEXT,
  display_name     TEXT,
  bio              TEXT,
  avatar_url       TEXT,
  followers        INTEGER DEFAULT 0,
  following        INTEGER DEFAULT 0,
  likes_total      BIGINT  DEFAULT 0,
  linked_venue_id  UUID REFERENCES venues(id) ON DELETE SET NULL,
  category         TEXT,          -- 'club' | 'artist' | 'promoter' | 'media'
  status           TEXT DEFAULT 'active',  -- 'active' | 'paused' | 'blocked'
  refresh_interval_h INTEGER DEFAULT 24,  -- hours between refreshes
  last_checked_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tiktok_accounts_status   ON tiktok_accounts(status);
CREATE INDEX IF NOT EXISTS idx_tiktok_accounts_venue    ON tiktok_accounts(linked_venue_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_accounts_refresh  ON tiktok_accounts(last_checked_at, refresh_interval_h);

DROP TRIGGER IF EXISTS tiktok_accounts_updated_at ON tiktok_accounts;
CREATE TRIGGER tiktok_accounts_updated_at
  BEFORE UPDATE ON tiktok_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 2. TIKTOK_VIDEOS
-- ============================================================
CREATE TABLE IF NOT EXISTS tiktok_videos (
  id               SERIAL PRIMARY KEY,
  account_id       INTEGER NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  video_url        TEXT NOT NULL UNIQUE,
  tiktok_id        TEXT,            -- TikTok internal video ID
  caption          TEXT,
  hashtags         TEXT[],          -- ['#control', '#techno', '#bucharest']
  thumbnail_url    TEXT,
  posted_at        TIMESTAMPTZ,
  views            INTEGER DEFAULT 0,
  likes            INTEGER DEFAULT 0,
  comments         INTEGER DEFAULT 0,
  shares           INTEGER DEFAULT 0,
  raw_json         JSONB,           -- full payload from Apify/provider
  processed        BOOLEAN DEFAULT FALSE,  -- signals extracted?
  last_checked_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tiktok_videos_account    ON tiktok_videos(account_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_videos_posted_at  ON tiktok_videos(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_tiktok_videos_processed  ON tiktok_videos(processed) WHERE NOT processed;
CREATE INDEX IF NOT EXISTS idx_tiktok_videos_hashtags   ON tiktok_videos USING GIN(hashtags);


-- ============================================================
-- 3. SIGNALS
-- Extracted intelligence from TikTok captions/hashtags
-- ============================================================
CREATE TABLE IF NOT EXISTS signals (
  id              SERIAL PRIMARY KEY,
  video_id        INTEGER NOT NULL REFERENCES tiktok_videos(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,    -- 'venue_name' | 'event_date' | 'ticket_url' | 'price' | 'promo_code'
  value           TEXT NOT NULL,    -- extracted value
  confidence      NUMERIC(5,4) DEFAULT 0.5,  -- 0.0 – 1.0
  matched_venue_id UUID REFERENCES venues(id)  ON DELETE SET NULL,
  matched_event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  review_status   TEXT DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  reviewer_note   TEXT,
  extracted_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_video        ON signals(video_id);
CREATE INDEX IF NOT EXISTS idx_signals_type         ON signals(type);
CREATE INDEX IF NOT EXISTS idx_signals_review       ON signals(review_status) WHERE review_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_signals_venue        ON signals(matched_venue_id) WHERE matched_venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signals_event        ON signals(matched_event_id) WHERE matched_event_id IS NOT NULL;


-- ============================================================
-- 4. TIKTOK_RUNS — audit log for collector jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS tiktok_runs (
  id              SERIAL PRIMARY KEY,
  account_id      INTEGER REFERENCES tiktok_accounts(id) ON DELETE SET NULL,
  provider        TEXT DEFAULT 'apify',  -- 'apify' | 'brightdata'
  status          TEXT,   -- 'success' | 'error' | 'partial'
  videos_fetched  INTEGER DEFAULT 0,
  videos_new      INTEGER DEFAULT 0,
  signals_new     INTEGER DEFAULT 0,
  error_msg       TEXT,
  duration_s      NUMERIC(8,2),
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tiktok_runs_account ON tiktok_runs(account_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tiktok_runs_status  ON tiktok_runs(status);


-- ============================================================
-- 5. USEFUL VIEWS
-- ============================================================

-- Pending signals for review inbox
CREATE OR REPLACE VIEW v_signals_inbox AS
SELECT
  s.id,
  s.type,
  s.value,
  s.confidence,
  s.review_status,
  s.extracted_at,
  v.caption,
  v.video_url,
  v.posted_at,
  a.username AS account_username,
  a.display_name AS account_name,
  ve.name AS matched_venue_name,
  e.title AS matched_event_title
FROM signals s
JOIN tiktok_videos v ON v.id = s.video_id
JOIN tiktok_accounts a ON a.id = v.account_id
LEFT JOIN venues ve ON ve.id = s.matched_venue_id
LEFT JOIN events e ON e.id = s.matched_event_id
WHERE s.review_status = 'pending'
ORDER BY s.confidence DESC, s.extracted_at DESC;


-- TikTok account health dashboard
CREATE OR REPLACE VIEW v_tiktok_account_health AS
SELECT
  a.id,
  a.username,
  a.display_name,
  a.followers,
  a.status,
  a.last_checked_at,
  a.refresh_interval_h,
  COUNT(DISTINCT v.id) AS total_videos,
  COUNT(DISTINCT v.id) FILTER (WHERE v.posted_at > NOW() - INTERVAL '7 days') AS videos_last_7d,
  COUNT(DISTINCT s.id) FILTER (WHERE s.review_status = 'pending') AS pending_signals,
  MAX(r.started_at) AS last_run_at,
  MAX(r.status) FILTER (WHERE r.started_at = (SELECT MAX(r2.started_at) FROM tiktok_runs r2 WHERE r2.account_id = a.id)) AS last_run_status
FROM tiktok_accounts a
LEFT JOIN tiktok_videos v ON v.account_id = a.id
LEFT JOIN signals s ON s.video_id = v.id
LEFT JOIN tiktok_runs r ON r.account_id = a.id
GROUP BY a.id, a.username, a.display_name, a.followers, a.status,
         a.last_checked_at, a.refresh_interval_h;


-- ============================================================
-- 6. RLS Policies (service_role bypasses these)
-- ============================================================
ALTER TABLE tiktok_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_videos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_runs     ENABLE ROW LEVEL SECURITY;

-- Only service_role (backend) can read/write — no public access
CREATE POLICY "tiktok_accounts: service only" ON tiktok_accounts USING (false);
CREATE POLICY "tiktok_videos: service only"   ON tiktok_videos   USING (false);
CREATE POLICY "signals: service only"         ON signals         USING (false);
CREATE POLICY "tiktok_runs: service only"     ON tiktok_runs     USING (false);


-- ============================================================
-- Done. Verify with:
--   SELECT COUNT(*) FROM tiktok_accounts;
--   SELECT * FROM v_signals_inbox LIMIT 5;
--   SELECT * FROM v_tiktok_account_health LIMIT 5;
-- ============================================================
