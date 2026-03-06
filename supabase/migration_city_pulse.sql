-- ============================================================
-- GOZI — City Pulse Migration
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. venue_presence: semnale brute anonime
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS venue_presence (
  id          BIGSERIAL    PRIMARY KEY,
  venue_id    INTEGER      NOT NULL,
  user_hash   TEXT         NOT NULL,  -- hash anonim zilnic, nu user_id real
  source      TEXT         NOT NULL CHECK (source IN (
                'gps_open', 'checkin', 'event_view',
                'maps_click', 'ticket_click', 'save'
              )),
  time_bucket TIMESTAMPTZ  NOT NULL,  -- granularitate 30 minute
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- Deduplicare: un semnal per user per venue per fereastra 30 min
CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_presence_dedup
  ON venue_presence (user_hash, venue_id, time_bucket);

-- Index pentru agregari rapide
CREATE INDEX IF NOT EXISTS idx_venue_presence_venue_time
  ON venue_presence (venue_id, created_at DESC);

-- Index pentru cleanup
CREATE INDEX IF NOT EXISTS idx_venue_presence_created
  ON venue_presence (created_at);


-- 2. venue_heat_cache: scoruri agregate (actualizate periodic)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS venue_heat_cache (
  venue_id              INTEGER      PRIMARY KEY,
  venue_name            TEXT,
  venue_lat             NUMERIC,
  venue_lng             NUMERIC,
  heat_score            NUMERIC(8,2) DEFAULT 0,
  heat_level            TEXT         NOT NULL DEFAULT 'chill'
                          CHECK (heat_level IN ('chill', 'moderate', 'busy', 'packed')),
  active_users_estimate INTEGER      DEFAULT 0,
  updated_at            TIMESTAMPTZ  DEFAULT NOW()
);


-- 3. Functie: calculeaza heat score pentru un venue
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_venue_heat(p_venue_id INTEGER)
RETURNS NUMERIC AS $$
DECLARE
  v_checkins       INTEGER;
  v_gps_users      INTEGER;
  v_ticket_clicks  INTEGER;
  v_saves          INTEGER;
  v_event_views    INTEGER;
  v_score          NUMERIC;
BEGIN
  SELECT COUNT(*)              INTO v_checkins
    FROM venue_presence WHERE venue_id = p_venue_id
    AND source = 'checkin'     AND created_at > NOW() - INTERVAL '4 hours';

  SELECT COUNT(DISTINCT user_hash) INTO v_gps_users
    FROM venue_presence WHERE venue_id = p_venue_id
    AND source = 'gps_open'    AND created_at > NOW() - INTERVAL '2 hours';

  SELECT COUNT(*)              INTO v_ticket_clicks
    FROM venue_presence WHERE venue_id = p_venue_id
    AND source = 'ticket_click' AND created_at > NOW() - INTERVAL '6 hours';

  SELECT COUNT(*)              INTO v_saves
    FROM venue_presence WHERE venue_id = p_venue_id
    AND source = 'save'        AND created_at > NOW() - INTERVAL '24 hours';

  SELECT COUNT(*)              INTO v_event_views
    FROM venue_presence WHERE venue_id = p_venue_id
    AND source = 'event_view'  AND created_at > NOW() - INTERVAL '3 hours';

  v_score := (v_checkins      * 5)
           + (v_gps_users     * 3)
           + (v_ticket_clicks * 2)
           + (v_saves         * 1)
           + (v_event_views   * 1);

  RETURN COALESCE(v_score, 0);
END;
$$ LANGUAGE plpgsql;


-- 4. Functie: actualizeaza cache-ul pentru toate venues
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_all_venue_heat()
RETURNS VOID AS $$
DECLARE
  v_venue  RECORD;
  v_score  NUMERIC;
  v_level  TEXT;
  v_active INTEGER;
BEGIN
  -- Itereaza prin venues care au avut activitate in ultimele 48h
  -- sau sunt deja in cache
  FOR v_venue IN
    SELECT DISTINCT vp.venue_id,
           e.venue   AS venue_name,
           e.lat     AS venue_lat,
           e.lng     AS venue_lng
    FROM venue_presence vp
    LEFT JOIN events e ON e.venue = (
      SELECT venue FROM events WHERE lat IS NOT NULL LIMIT 1
    )
    WHERE vp.created_at > NOW() - INTERVAL '48 hours'
    UNION
    SELECT venue_id, venue_name, venue_lat, venue_lng
    FROM venue_heat_cache
  LOOP
    v_score := compute_venue_heat(v_venue.venue_id);

    IF    v_score <= 20  THEN v_level := 'chill';
    ELSIF v_score <= 50  THEN v_level := 'moderate';
    ELSIF v_score <= 100 THEN v_level := 'busy';
    ELSE                      v_level := 'packed';
    END IF;

    SELECT COUNT(DISTINCT user_hash) INTO v_active
      FROM venue_presence
      WHERE venue_id = v_venue.venue_id
        AND created_at > NOW() - INTERVAL '2 hours';

    INSERT INTO venue_heat_cache
      (venue_id, venue_name, venue_lat, venue_lng,
       heat_score, heat_level, active_users_estimate, updated_at)
    VALUES
      (v_venue.venue_id, v_venue.venue_name, v_venue.venue_lat, v_venue.venue_lng,
       v_score, v_level, COALESCE(v_active, 0), NOW())
    ON CONFLICT (venue_id) DO UPDATE
      SET heat_score            = EXCLUDED.heat_score,
          heat_level            = EXCLUDED.heat_level,
          active_users_estimate = EXCLUDED.active_users_estimate,
          updated_at            = NOW();
  END LOOP;
END;
$$ LANGUAGE plpgsql;


-- 5. RPC: logheza prezenta cu deduplicare automata
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_venue_presence(
  p_venue_id  INTEGER,
  p_user_hash TEXT,
  p_source    TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_bucket TIMESTAMPTZ;
BEGIN
  -- Fereastra de 30 minute
  v_bucket := date_trunc('hour', NOW())
            + (FLOOR(EXTRACT(MINUTE FROM NOW()) / 30) * INTERVAL '30 minutes');

  INSERT INTO venue_presence (venue_id, user_hash, source, time_bucket)
  VALUES (p_venue_id, p_user_hash, p_source, v_bucket)
  ON CONFLICT (user_hash, venue_id, time_bucket) DO NOTHING;

  -- Update heat cache imediat pentru UX responsiv
  PERFORM compute_venue_heat(p_venue_id);

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 6. Cleanup: sterge semnale vechi >48h (rulat zilnic via cron)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_old_presence()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM venue_presence
  WHERE created_at < NOW() - INTERVAL '48 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;


-- 7. RLS policies (venue_presence — insert only, no select)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE venue_presence ENABLE ROW LEVEL SECURITY;

-- Nimeni nu poate citi prezentele individuale — doar functii SECURITY DEFINER
CREATE POLICY "no_read_presence" ON venue_presence
  FOR SELECT USING (FALSE);

-- Oricine poate insera (via RPC log_venue_presence)
-- (RPC e SECURITY DEFINER deci nu necesita policy separata)

-- venue_heat_cache e public readable
ALTER TABLE venue_heat_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_heat_cache" ON venue_heat_cache
  FOR SELECT USING (TRUE);


-- 8. Verifica instalarea
-- ─────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_name = 'venue_presence')   AS venue_presence_exists,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_name = 'venue_heat_cache') AS venue_heat_cache_exists,
  (SELECT COUNT(*) FROM information_schema.routines
   WHERE routine_name = 'log_venue_presence') AS rpc_exists;
