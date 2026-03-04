-- ============================================================
-- GOZI — Migration: add website_crawled_at to venues
-- Safe to run on existing databases (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
--
-- Run with:
--   python3 supabase/run_sql.py supabase/migrate_v2_venues.sql
-- Or paste into: Supabase Dashboard > SQL Editor
-- ============================================================

-- Add website_crawled_at to venues table if it doesn't exist
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS website_crawled_at TIMESTAMPTZ;

COMMENT ON COLUMN venues.website_crawled_at
  IS 'Last time venue_cron.py crawled this website for events';

CREATE INDEX IF NOT EXISTS idx_venues_crawled_at
  ON venues(website_crawled_at)
  WHERE website IS NOT NULL;
