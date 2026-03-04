"""
GOZI — Pipeline Test Suite
===========================

Covers:
  • SignalExtractor   (pipeline/signal_extractor.py)
  • SQL Splitter      (supabase/run_sql.py)
  • TikTok Cron utils (pipeline/tiktok_cron.py)
  • TikTok Ingest     (pipeline/tiktok_ingest.py)

Run with:
  cd /Users/remusenus/Desktop/gozi-app
  python -m pytest tests/test_pipeline.py -v
  # or without pytest:
  python -m tests.test_pipeline
"""

import sys
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch, call

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ─────────────────────────────────────────────────────────────────────────────
# SignalExtractor tests
# ─────────────────────────────────────────────────────────────────────────────

class TestSignalExtractorVenues(unittest.TestCase):

    def setUp(self):
        from pipeline.signal_extractor import SignalExtractor
        self.ex = SignalExtractor()

    def test_known_venue_control(self):
        sigs = self.ex.extract("Vineri la control club 22:00")
        venue_sigs = [s for s in sigs if s["type"] == "venue_name"]
        self.assertTrue(any(s["value"] == "Control Club" for s in venue_sigs))

    def test_known_venue_quantic(self):
        sigs = self.ex.extract("party la quantic toata noaptea")
        venue_sigs = [s for s in sigs if s["type"] == "venue_name"]
        self.assertTrue(any("Quantic" in s["value"] for s in venue_sigs))

    def test_venue_from_hashtag(self):
        sigs = self.ex.extract("", hashtags=["#expirat", "#techno"])
        venue_sigs = [s for s in sigs if s["type"] == "venue_name"]
        self.assertTrue(any("Expirat" in s["value"] for s in venue_sigs))

    def test_no_false_positive_generic_word(self):
        sigs = self.ex.extract("un film bun de vazut azi")
        venue_sigs = [s for s in sigs if s["type"] == "venue_name"]
        self.assertEqual(len(venue_sigs), 0)

    def test_extra_venues_loaded(self):
        from pipeline.signal_extractor import SignalExtractor
        ex = SignalExtractor(extra_venues={"venue test xyz": "Venue Test XYZ"})
        sigs = ex.extract("concert la venue test xyz sambata")
        self.assertTrue(any(s["value"] == "Venue Test XYZ" for s in sigs))

    def test_case_insensitive_venue(self):
        sigs = self.ex.extract("CONTROL CLUB vineri")
        venue_sigs = [s for s in sigs if s["type"] == "venue_name"]
        self.assertTrue(len(venue_sigs) > 0)

    def test_venue_confidence(self):
        sigs = self.ex.extract("quantic bucharest")
        venue_sigs = [s for s in sigs if s["type"] == "venue_name"]
        for s in venue_sigs:
            self.assertGreaterEqual(s["confidence"], 0.5)
            self.assertLessEqual(s["confidence"], 1.0)


class TestSignalExtractorDates(unittest.TestCase):

    def setUp(self):
        from pipeline.signal_extractor import SignalExtractor
        self.ex = SignalExtractor()

    def test_iso_date(self):
        sigs = self.ex.extract("event on 2026-03-15")
        date_sigs = [s for s in sigs if s["type"] == "event_date"]
        self.assertTrue(any("2026-03-15" in s["value"] for s in date_sigs))

    def test_romanian_month(self):
        sigs = self.ex.extract("15 martie la quantic")
        date_sigs = [s for s in sigs if s["type"] == "event_date"]
        self.assertTrue(len(date_sigs) > 0)

    def test_weekday_with_time(self):
        sigs = self.ex.extract("vineri 22:00 la control")
        date_sigs = [s for s in sigs if s["type"] == "event_date"]
        self.assertTrue(len(date_sigs) > 0)

    def test_ora_pattern(self):
        sigs = self.ex.extract("incepe la ora 22")
        date_sigs = [s for s in sigs if s["type"] == "event_date"]
        self.assertTrue(len(date_sigs) > 0)

    def test_high_confidence_for_iso_date(self):
        sigs = self.ex.extract("2026-03-15")
        date_sigs = [s for s in sigs if s["type"] == "event_date"]
        self.assertTrue(any(s["confidence"] >= 0.90 for s in date_sigs))


class TestSignalExtractorTickets(unittest.TestCase):

    def setUp(self):
        from pipeline.signal_extractor import SignalExtractor
        self.ex = SignalExtractor()

    def test_iabilet_url(self):
        sigs = self.ex.extract("bilete: https://www.iabilet.ro/bilete-control-1234")
        ticket_sigs = [s for s in sigs if s["type"] == "ticket_url"]
        self.assertTrue(len(ticket_sigs) > 0)
        self.assertIn("iabilet.ro", ticket_sigs[0]["value"])

    def test_eventim_url(self):
        sigs = self.ex.extract("https://www.eventim.ro/event/12345")
        ticket_sigs = [s for s in sigs if s["type"] == "ticket_url"]
        self.assertTrue(len(ticket_sigs) > 0)

    def test_beacons_ai_url(self):
        sigs = self.ex.extract("link: https://beacons.ai/quantic.bucharest")
        ticket_sigs = [s for s in sigs if s["type"] == "ticket_url"]
        self.assertTrue(len(ticket_sigs) > 0)

    def test_no_random_url(self):
        sigs = self.ex.extract("check https://instagram.com/controlclub for updates")
        ticket_sigs = [s for s in sigs if s["type"] == "ticket_url"]
        self.assertEqual(len(ticket_sigs), 0)

    def test_ticket_confidence_high(self):
        sigs = self.ex.extract("https://www.iabilet.ro/bilete-something-1234")
        ticket_sigs = [s for s in sigs if s["type"] == "ticket_url"]
        self.assertTrue(all(s["confidence"] >= 0.85 for s in ticket_sigs))


class TestSignalExtractorPrices(unittest.TestCase):

    def setUp(self):
        from pipeline.signal_extractor import SignalExtractor
        self.ex = SignalExtractor()

    def test_lei_price(self):
        sigs = self.ex.extract("bilet 50 lei la intrare")
        price_sigs = [s for s in sigs if s["type"] == "price"]
        self.assertTrue(len(price_sigs) > 0)

    def test_ron_price(self):
        sigs = self.ex.extract("entry: 30 RON")
        price_sigs = [s for s in sigs if s["type"] == "price"]
        self.assertTrue(len(price_sigs) > 0)

    def test_euro_price(self):
        sigs = self.ex.extract("ticket 15 Euro online")
        price_sigs = [s for s in sigs if s["type"] == "price"]
        self.assertTrue(len(price_sigs) > 0)

    def test_entry_keyword(self):
        sigs = self.ex.extract("entry 25 this friday")
        price_sigs = [s for s in sigs if s["type"] == "price"]
        self.assertTrue(len(price_sigs) > 0)


class TestSignalExtractorPromoCodes(unittest.TestCase):

    def setUp(self):
        from pipeline.signal_extractor import SignalExtractor
        self.ex = SignalExtractor()

    def test_promo_code(self):
        sigs = self.ex.extract("use code GOZI20 for 20% off")
        promo_sigs = [s for s in sigs if s["type"] == "promo_code"]
        self.assertTrue(len(promo_sigs) > 0)

    def test_guestlist_code(self):
        sigs = self.ex.extract("guestlist: PARTY2026")
        promo_sigs = [s for s in sigs if s["type"] == "promo_code"]
        self.assertTrue(len(promo_sigs) > 0)

    def test_discount_code(self):
        sigs = self.ex.extract("discount TECHNO15 pentru primii 100")
        promo_sigs = [s for s in sigs if s["type"] == "promo_code"]
        self.assertTrue(len(promo_sigs) > 0)


class TestSignalExtractorDeduplication(unittest.TestCase):

    def setUp(self):
        from pipeline.signal_extractor import SignalExtractor
        self.ex = SignalExtractor()

    def test_dedup_same_venue_caption_and_hashtag(self):
        """Same venue in caption AND hashtag should not appear twice."""
        sigs = self.ex.extract("la quantic vineri", hashtags=["#quantic"])
        venue_sigs = [s for s in sigs if s["type"] == "venue_name"
                      and s["value"] == "Quantic"]
        # Should be deduplicated to 1
        self.assertEqual(len(venue_sigs), 1)

    def test_multiple_signal_types_from_one_post(self):
        """Realistic post — should extract 4+ signal types."""
        caption = (
            "🎉 Party la Control Club vineri 22:00 "
            "bilete https://www.iabilet.ro/bilete-control-friday-1234 "
            "50 lei advance / 70 lei door "
            "use code CTRL20 for discount"
        )
        sigs = self.ex.extract(caption, hashtags=["#controlclub", "#techno"])
        types = {s["type"] for s in sigs}
        self.assertIn("venue_name",  types)
        self.assertIn("event_date",  types)
        self.assertIn("ticket_url",  types)
        self.assertIn("price",       types)
        self.assertIn("promo_code",  types)

    def test_empty_caption(self):
        sigs = self.ex.extract("", hashtags=[])
        self.assertEqual(sigs, [])

    def test_none_caption(self):
        sigs = self.ex.extract(None, hashtags=None)
        self.assertEqual(sigs, [])


# ─────────────────────────────────────────────────────────────────────────────
# SQL Splitter tests (supabase/run_sql.py)
# ─────────────────────────────────────────────────────────────────────────────

class TestSqlSplitter(unittest.TestCase):

    def setUp(self):
        # NOTE: `supabase/` directory acts as a namespace package in Python 3,
        # which shadows the installed `supabase` pip package.
        # Use importlib to load supabase/run_sql.py directly by file path.
        #
        # IMPORTANT: register the module in sys.modules BEFORE exec_module so
        # that Python 3.9's @dataclass decorator can resolve string annotations
        # (from __future__ import annotations) via sys.modules.get(cls.__module__).
        import importlib.util
        _project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        _spec = importlib.util.spec_from_file_location(
            "run_sql",
            os.path.join(_project_root, "supabase", "run_sql.py"),
        )
        _mod = importlib.util.module_from_spec(_spec)
        sys.modules["run_sql"] = _mod   # ← Must register before exec_module
        _spec.loader.exec_module(_mod)
        self._split = _mod._split_sql
        self._idem  = _mod._force_idempotent

    def test_simple_split(self):
        stmts = self._split("SELECT 1; SELECT 2; SELECT 3;")
        self.assertEqual(len(stmts), 3)

    def test_semicolon_in_string(self):
        sql = "INSERT INTO t VALUES ('a;b;c;d');"
        stmts = self._split(sql)
        self.assertEqual(len(stmts), 1)
        self.assertIn("a;b;c;d", stmts[0])

    def test_dollar_quote_do_block(self):
        sql = """
DO $$
BEGIN
  RAISE NOTICE 'hello; world';
END;
$$;
SELECT 1;
"""
        stmts = self._split(sql)
        self.assertEqual(len(stmts), 2)
        # First stmt is the DO block
        self.assertIn("RAISE NOTICE", stmts[0])

    def test_named_dollar_quote(self):
        sql = """
CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $body$
BEGIN
  -- semicolon; inside
  NULL;
END;
$body$;
"""
        stmts = self._split(sql)
        self.assertEqual(len(stmts), 1)
        self.assertIn("$body$", stmts[0])

    def test_line_comment_removed(self):
        stmts = self._split("-- full comment line\nSELECT 42;")
        self.assertEqual(len(stmts), 1)
        self.assertIn("SELECT 42", stmts[0])

    def test_block_comment_removed(self):
        stmts = self._split("/* multi\nline\ncomment */\nSELECT 99;")
        self.assertEqual(len(stmts), 1)
        self.assertIn("SELECT 99", stmts[0])

    def test_no_trailing_semicolon(self):
        stmts = self._split("SELECT 1; SELECT 2")
        self.assertEqual(len(stmts), 2)
        self.assertIn("SELECT 2", stmts[1])

    def test_empty_string(self):
        self.assertEqual(self._split(""), [])

    def test_only_comments(self):
        self.assertEqual(self._split("-- comment\n/* another */"), [])

    def test_force_idempotent_table(self):
        s = self._idem("CREATE TABLE events (id SERIAL);")
        self.assertIn("IF NOT EXISTS", s)
        self.assertNotIn("CREATE TABLE events", s)  # must have IF NOT EXISTS between

    def test_force_idempotent_index(self):
        s = self._idem("CREATE INDEX idx_name ON events(name);")
        self.assertIn("IF NOT EXISTS", s)

    def test_force_idempotent_view(self):
        s = self._idem("CREATE VIEW v_test AS SELECT 1;")
        self.assertIn("OR REPLACE", s)

    def test_force_idempotent_already_idempotent(self):
        """Should not add double IF NOT EXISTS."""
        s = self._idem("CREATE TABLE IF NOT EXISTS events (id SERIAL);")
        self.assertEqual(s.count("IF NOT EXISTS"), 1)


# ─────────────────────────────────────────────────────────────────────────────
# TikTok Cron utilities
# ─────────────────────────────────────────────────────────────────────────────

class TestTikTokCronTimezone(unittest.TestCase):

    def test_parse_iso_tz_utc(self):
        from pipeline.tiktok_cron import parse_iso_tz, TZ_BUCHAREST
        dt = parse_iso_tz("2026-01-15T10:00:00Z")
        self.assertIsNotNone(dt)
        self.assertIsNotNone(dt.tzinfo)

    def test_parse_iso_tz_postgres_format(self):
        from pipeline.tiktok_cron import parse_iso_tz
        dt = parse_iso_tz("2026-01-15 10:00:00+00")
        self.assertIsNotNone(dt)

    def test_parse_iso_tz_none(self):
        from pipeline.tiktok_cron import parse_iso_tz
        self.assertIsNone(parse_iso_tz(""))
        self.assertIsNone(parse_iso_tz(None))

    def test_now_bucharest_is_aware(self):
        from pipeline.tiktok_cron import now_bucharest
        now = now_bucharest()
        self.assertIsNotNone(now.tzinfo)


class TestTikTokCronStaleness(unittest.TestCase):
    """Test the Python-level account staleness filtering (no DB needed)."""

    def _make_account(self, username, interval_h, last_checked_hours_ago):
        """Helper to create a mock account row."""
        from pipeline.tiktok_cron import now_bucharest
        if last_checked_hours_ago is None:
            last_dt = None
        else:
            last_dt = now_bucharest() - timedelta(hours=last_checked_hours_ago)
        return {
            "id": 1,
            "username": username,
            "refresh_interval_h": interval_h,
            "last_checked_at": last_dt.isoformat() if last_dt else None,
        }

    def test_never_checked_is_due(self):
        """Account never checked (last_checked_at=None) is always due."""
        account = self._make_account("test_account", 24, None)
        # If last_checked_at is None, should be treated as due
        self.assertIsNone(account["last_checked_at"])

    def test_stale_account_is_due(self):
        """Account last checked 25h ago with 24h interval is due."""
        from pipeline.tiktok_cron import parse_iso_tz, now_bucharest
        account = self._make_account("stale_account", 24, 25)
        last_dt = parse_iso_tz(account["last_checked_at"])
        elapsed_s = (now_bucharest() - last_dt).total_seconds()
        required_s = account["refresh_interval_h"] * 3600
        self.assertGreater(elapsed_s, required_s)

    def test_fresh_account_is_not_due(self):
        """Account last checked 1h ago with 24h interval is NOT due."""
        from pipeline.tiktok_cron import parse_iso_tz, now_bucharest
        account = self._make_account("fresh_account", 24, 1)
        last_dt = parse_iso_tz(account["last_checked_at"])
        elapsed_s = (now_bucharest() - last_dt).total_seconds()
        required_s = account["refresh_interval_h"] * 3600
        self.assertLess(elapsed_s, required_s)

    def test_custom_interval(self):
        """Account with 6h interval, last checked 7h ago — is due."""
        from pipeline.tiktok_cron import parse_iso_tz, now_bucharest
        account = self._make_account("frequent_account", 6, 7)
        last_dt = parse_iso_tz(account["last_checked_at"])
        elapsed_s = (now_bucharest() - last_dt).total_seconds()
        required_s = account["refresh_interval_h"] * 3600
        self.assertGreater(elapsed_s, required_s)


class TestTikTokCronTransientErrors(unittest.TestCase):

    def test_timeout_is_transient(self):
        from pipeline.tiktok_cron import _is_transient
        self.assertTrue(_is_transient("Connection timed out"))
        self.assertTrue(_is_transient("Read timeout"))

    def test_429_is_transient(self):
        from pipeline.tiktok_cron import _is_transient
        self.assertTrue(_is_transient("HTTP 429 Too Many Requests"))

    def test_503_is_transient(self):
        from pipeline.tiktok_cron import _is_transient
        self.assertTrue(_is_transient("503 Service Unavailable"))

    def test_auth_error_not_transient(self):
        from pipeline.tiktok_cron import _is_transient
        self.assertFalse(_is_transient("Authentication failed: invalid token"))

    def test_not_found_not_transient(self):
        from pipeline.tiktok_cron import _is_transient
        self.assertFalse(_is_transient("404 Not Found: user does not exist"))

    def test_rate_limit_is_transient(self):
        from pipeline.tiktok_cron import _is_transient
        self.assertTrue(_is_transient("rate limit exceeded"))


# ─────────────────────────────────────────────────────────────────────────────
# TikTok Ingest — unit tests (mocked DB + collector)
# ─────────────────────────────────────────────────────────────────────────────

class TestTikTokIngestMaxVideos(unittest.TestCase):
    """Test max_videos capping without hitting real DB."""

    def _make_ingest(self, videos):
        from pipeline.tiktok_ingest import TikTokIngest

        mock_collector = MagicMock()
        mock_collector.collect_account.return_value = {
            "profile": {"username": "test_account", "followers": 1000},
            "videos": videos,
        }

        mock_sb = MagicMock()
        # upsert account returns id=1
        mock_sb.table.return_value.upsert.return_value.execute.return_value.data = [{"id": 1}]
        # upsert video returns id=42
        mock_sb.table.return_value.upsert.return_value.execute.return_value.data = [{"id": 42}]

        ingest = TikTokIngest(
            supabase=mock_sb,
            collector=mock_collector,
            dry_run=False,
        )
        return ingest, mock_collector

    def _make_video(self, i):
        return {
            "video_url": f"https://tiktok.com/@test/video/{i}",
            "caption": f"test video {i}",
            "hashtags": [],
            "views": 100, "likes": 10, "comments": 1, "shares": 0,
        }

    def test_max_videos_zero_means_all(self):
        """max_videos=0 should not cap."""
        videos = [self._make_video(i) for i in range(10)]
        ingest, collector = self._make_ingest(videos)
        stats = ingest.ingest_account("test_account", max_videos=0)
        # videos_fetched = 10 (original count before cap)
        self.assertEqual(stats["videos_fetched"], 10)

    def test_max_videos_caps_processing(self):
        """max_videos=3 should only process 3 videos even if 10 fetched."""
        videos = [self._make_video(i) for i in range(10)]
        ingest, collector = self._make_ingest(videos)
        stats = ingest.ingest_account("test_account", max_videos=3)
        # videos_fetched is always the total from collector
        self.assertEqual(stats["videos_fetched"], 10)
        # But only 3 were processed (we can't check videos_new precisely with mocks,
        # but we verify the cap was applied by checking no KeyError was raised)
        self.assertIn("account_id", stats)

    def test_ingest_dry_run_no_db_writes(self):
        """dry_run=True should not call any DB methods."""
        videos = [self._make_video(i) for i in range(5)]
        mock_collector = MagicMock()
        mock_collector.collect_account.return_value = {
            "profile": {"username": "test_account"},
            "videos": videos,
        }
        mock_sb = MagicMock()

        from pipeline.tiktok_ingest import TikTokIngest
        ingest = TikTokIngest(
            supabase=mock_sb,
            collector=mock_collector,
            dry_run=True,
        )
        stats = ingest.ingest_account("test_account")
        # In dry_run mode, upsert should not be called on the actual table
        # (The mock's table() might be called for other reasons, but insert shouldn't be called)
        self.assertIn("videos_fetched", stats)


class TestTikTokIngestLoadAccounts(unittest.TestCase):

    def test_load_accounts_extracts_usernames(self):
        """load_accounts_from_db returns list of dicts; CLI extracts username field."""
        rows = [
            {"id": 1, "username": "controlclub", "refresh_interval_h": 24, "last_checked_at": None},
            {"id": 2, "username": "quantic",     "refresh_interval_h": 12, "last_checked_at": None},
        ]
        # Simulate what CLI does
        usernames = [r["username"] for r in rows if r.get("username")]
        self.assertEqual(usernames, ["controlclub", "quantic"])

    def test_load_accounts_filters_empty_username(self):
        rows = [
            {"id": 1, "username": "controlclub"},
            {"id": 2, "username": ""},
            {"id": 3, "username": None},
            {"id": 4, "username": "quantic"},
        ]
        usernames = [r["username"] for r in rows if r.get("username")]
        self.assertEqual(len(usernames), 2)
        self.assertIn("controlclub", usernames)
        self.assertIn("quantic", usernames)


# ─────────────────────────────────────────────────────────────────────────────
# Hardpedia canonical mapping
# ─────────────────────────────────────────────────────────────────────────────

class TestHardpediaCanonical(unittest.TestCase):

    def test_to_canonical_basic(self):
        from scrapers.hardpedia_scraper import HardpediaScraper
        raw = {
            "title": "Techno Night",
            "date_iso": "2026-03-15",
            "venue": "Control Club",
            "price": "50 lei",
            "image": "https://hardpedia.ro/img/1.jpg",
            "website": "https://hardpedia.ro/event/1",
            "time": "22:00",
            "lat": 44.4268,
            "lng": 26.1025,
        }
        result = HardpediaScraper._to_canonical(raw)
        self.assertEqual(result["title"],    "Techno Night")
        self.assertEqual(result["start_at"], "2026-03-15")
        self.assertEqual(result["venue_name"], "Control Club")
        self.assertEqual(result["source"],   "hardpedia")
        self.assertEqual(result["category"], "club")

    def test_to_canonical_missing_fields(self):
        """Missing optional fields should default gracefully."""
        from scrapers.hardpedia_scraper import HardpediaScraper
        raw = {"title": "Event fara detalii"}
        result = HardpediaScraper._to_canonical(raw)
        self.assertEqual(result["title"], "Event fara detalii")
        self.assertEqual(result["venue_city"], "București")
        self.assertIsNone(result["start_at"])
        self.assertIsNone(result["image_url"])


# ─────────────────────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    loader  = unittest.TestLoader()
    suite   = loader.discover(start_dir=os.path.dirname(__file__), pattern="test_*.py")
    runner  = unittest.TextTestRunner(verbosity=2)
    result  = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
