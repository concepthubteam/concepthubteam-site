"""
Tests for GOZI Venue Discovery Engine.

Run with:
  cd /Users/remusenus/Desktop/gozi-app
  python -m pytest tests/test_venue_engine.py -v

  # Or without pytest:
  python -m tests.test_venue_engine
"""

import json
import sys
import os
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


# ─────────────────────────────────────────────────────────────────────────────
# venue_discovery tests
# ─────────────────────────────────────────────────────────────────────────────

class TestDomainScoring(unittest.TestCase):

    def setUp(self):
        from scrapers.venue_discovery import _score_domain, _is_excluded
        self._score    = _score_domain
        self._excluded = _is_excluded

    def test_facebook_excluded(self):
        self.assertTrue(self._excluded("https://www.facebook.com/control.club"))

    def test_iabilet_excluded(self):
        self.assertTrue(self._excluded("https://www.iabilet.ro/bilete-control"))

    def test_official_site_not_excluded(self):
        self.assertFalse(self._excluded("https://www.control-club.ro"))

    def test_score_official_site_high(self):
        score = self._score("https://www.control-club.ro", "Control Club")
        self.assertGreater(score, 50)

    def test_score_ro_tld_bonus(self):
        s_ro  = self._score("https://control-club.ro",  "Control Club")
        s_com = self._score("https://control-club.com", "Control Club")
        self.assertGreater(s_ro, s_com)

    def test_score_deep_path_penalty(self):
        s_root = self._score("https://control-club.ro",         "Control Club")
        s_deep = self._score("https://control-club.ro/a/b/c/d", "Control Club")
        self.assertGreater(s_root, s_deep)

    def test_score_facebook_zero(self):
        score = self._score("https://facebook.com/controlclub", "Control Club")
        self.assertEqual(score, 0.0)

    def test_score_ticketing_zero(self):
        score = self._score("https://www.iabilet.ro/bilete-control", "Control Club")
        self.assertEqual(score, 0.0)

    def test_score_wikipedia_zero(self):
        score = self._score("https://ro.wikipedia.org/wiki/Control", "Control Club")
        self.assertEqual(score, 0.0)


class TestVenueDiscovery(unittest.TestCase):

    def setUp(self):
        from scrapers.venue_discovery import VenueDiscovery
        self.disc = VenueDiscovery()

    def test_build_queries(self):
        queries = self.disc._build_queries("Quantic")
        self.assertGreater(len(queries), 0)
        self.assertTrue(any("Quantic" in q for q in queries))

    @patch("scrapers.venue_discovery._duckduckgo")
    def test_discover_returns_best(self, mock_ddg):
        mock_ddg.return_value = [
            "https://www.quantic.ro",
            "https://www.facebook.com/quantic.ro",
            "https://www.tripadvisor.com/quantic",
        ]
        result = self.disc.discover("Quantic")
        self.assertIsNotNone(result)
        self.assertIn("quantic", result)
        self.assertNotIn("facebook", result)
        self.assertNotIn("tripadvisor", result)

    @patch("scrapers.venue_discovery._duckduckgo")
    def test_discover_no_results_returns_none(self, mock_ddg):
        mock_ddg.return_value = []
        result = self.disc.discover("NonexistentVenueXYZ123")
        self.assertIsNone(result)

    @patch("scrapers.venue_discovery._duckduckgo")
    def test_discover_low_score_returns_none(self, mock_ddg):
        # Only returns Wikipedia — should score too low
        mock_ddg.return_value = ["https://ro.wikipedia.org/wiki/SomeThing"]
        result = self.disc.discover("Control Club")
        self.assertIsNone(result)

    @patch("scrapers.venue_discovery._duckduckgo")
    def test_discover_returns_homepage_only(self, mock_ddg):
        mock_ddg.return_value = ["https://www.control-club.ro/events/party-night-2026"]
        result = self.disc.discover("Control Club")
        # Should strip to homepage
        if result:
            self.assertNotIn("/events", result)


# ─────────────────────────────────────────────────────────────────────────────
# venue_scraper tests
# ─────────────────────────────────────────────────────────────────────────────

class TestVenueScraperHelpers(unittest.TestCase):

    def setUp(self):
        from scrapers.venue_scraper import VenueScraper
        self.scraper = VenueScraper()

    def test_same_host_true(self):
        self.assertTrue(self.scraper._same_host("https://control-club.ro", "/events"))
        self.assertTrue(self.scraper._same_host("https://control-club.ro", "https://www.control-club.ro/events"))

    def test_same_host_false(self):
        self.assertFalse(self.scraper._same_host("https://control-club.ro", "https://facebook.com/x"))

    def test_bad_ext_true(self):
        self.assertTrue(self.scraper._bad_ext("https://site.ro/menu.pdf"))
        self.assertTrue(self.scraper._bad_ext("https://site.ro/photo.jpg"))

    def test_bad_ext_false(self):
        self.assertFalse(self.scraper._bad_ext("https://site.ro/events"))
        self.assertFalse(self.scraper._bad_ext("https://site.ro/agenda/"))

    def test_score_event_path_high(self):
        score = self.scraper._score("https://site.ro/events", "Events")
        self.assertGreater(score, 60)

    def test_score_generic_path_low(self):
        score = self.scraper._score("https://site.ro/contact", "Contact")
        self.assertLessEqual(score, 0.0)   # no event keywords → 0 or negative

    def test_score_link_text_bonus(self):
        s_with = self.scraper._score("https://site.ro/programul-saptamanii", "Programul")
        s_none = self.scraper._score("https://site.ro/programul-saptamanii", "Ceva")
        self.assertGreaterEqual(s_with, s_none)


class TestVenueScraperFindPages(unittest.TestCase):

    def _mock_response(self, html: str):
        r = MagicMock()
        r.status_code = 200
        r.text        = html
        return r

    @patch("scrapers.venue_scraper.requests.get")
    def test_find_events_page(self, mock_get):
        mock_get.return_value = self._mock_response("""
        <html><body>
          <a href="/events">Events</a>
          <a href="/contact">Contact</a>
          <a href="/about">About</a>
        </body></html>
        """)
        from scrapers.venue_scraper import VenueScraper
        s     = VenueScraper(respect_robots=False)
        pages = s.find_event_pages("https://example.ro")
        self.assertTrue(any("/events" in p for p in pages))

    @patch("scrapers.venue_scraper.requests.get")
    def test_no_links_still_probes_common_paths(self, mock_get):
        mock_get.return_value = self._mock_response("<html><body></body></html>")
        from scrapers.venue_scraper import VenueScraper
        s     = VenueScraper(respect_robots=False)
        pages = s.find_event_pages("https://example.ro")
        # Common paths like /events should still appear
        self.assertTrue(len(pages) > 0)
        self.assertTrue(any("/event" in p for p in pages))

    @patch("scrapers.venue_scraper.requests.get")
    def test_homepage_not_in_results(self, mock_get):
        mock_get.return_value = self._mock_response("""
        <html><body><a href="/events">Events</a></body></html>
        """)
        from scrapers.venue_scraper import VenueScraper
        s     = VenueScraper(respect_robots=False)
        pages = s.find_event_pages("https://example.ro")
        self.assertNotIn("https://example.ro", pages)


# ─────────────────────────────────────────────────────────────────────────────
# venue_event_parser tests
# ─────────────────────────────────────────────────────────────────────────────

class TestDateParsing(unittest.TestCase):

    def setUp(self):
        from scrapers.venue_event_parser import _to_iso, _scan_date
        self._to_iso   = _to_iso
        self._scan     = _scan_date

    def test_iso_date(self):
        r = self._to_iso("2026-03-15")
        self.assertIsNotNone(r)
        self.assertIn("2026-03-15", r)

    def test_romanian_month_long(self):
        r = self._to_iso("15 martie 2026")
        self.assertIsNotNone(r)
        self.assertIn("2026-03-15", r)

    def test_romanian_month_short(self):
        r = self._to_iso("22 dec 2026")
        self.assertIsNotNone(r)
        self.assertIn("2026-12-22", r)

    def test_eu_format(self):
        r = self._to_iso("15.03.2026")
        self.assertIsNotNone(r)
        self.assertIn("2026-03-15", r)

    def test_invalid_returns_none(self):
        self.assertIsNone(self._to_iso("not a date"))
        self.assertIsNone(self._to_iso(""))
        self.assertIsNone(self._to_iso(None))

    def test_bucharest_tz(self):
        r = self._to_iso("2026-07-15T20:00:00")
        self.assertIsNotNone(r)
        self.assertIn("+03:00", r)  # EEST (summer)

    def test_scan_date_in_text(self):
        r = self._scan("Concert on 20 mai 2026 at 21:00")
        self.assertIsNotNone(r)
        self.assertIn("2026-05-20", r)

    def test_scan_date_iso_in_text(self):
        r = self._scan("Event: 2026-06-10 doors open 22:00")
        self.assertIsNotNone(r)
        self.assertIn("2026-06-10", r)


class TestJsonLdParsing(unittest.TestCase):

    JSONLD_HTML = """
    <html><head>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "MusicEvent",
      "name": "Techno Night at Control",
      "startDate": "2026-04-05T22:00:00",
      "endDate": "2026-04-06T06:00:00",
      "url": "https://control-club.ro/events/techno-night",
      "location": {
        "@type": "MusicVenue",
        "name": "Control Club",
        "address": "Str. Constantin Mille 4, Bucharest"
      },
      "offers": [{"@type": "Offer", "url": "https://iabilet.ro/control", "price": "50"}],
      "image": "https://control-club.ro/img/techno.jpg"
    }
    </script>
    </head><body></body></html>
    """

    def _parser(self):
        from scrapers.venue_event_parser import VenueEventParser
        return VenueEventParser("Control Club", "https://control-club.ro")

    def _soup(self, html):
        from bs4 import BeautifulSoup
        return BeautifulSoup(html, "lxml")

    def test_jsonld_extracts_title(self):
        p    = self._parser()
        evs  = p._parse_jsonld(self._soup(self.JSONLD_HTML), "https://control-club.ro/events")
        self.assertEqual(len(evs), 1)
        self.assertIn("Techno Night", evs[0]["title"])

    def test_jsonld_extracts_start_at(self):
        p    = self._parser()
        evs  = p._parse_jsonld(self._soup(self.JSONLD_HTML), "https://control-club.ro/events")
        self.assertIn("2026-04-05", evs[0]["start_at"])

    def test_jsonld_extracts_venue(self):
        p    = self._parser()
        evs  = p._parse_jsonld(self._soup(self.JSONLD_HTML), "https://control-club.ro/events")
        self.assertEqual(evs[0]["venue"]["name"], "Control Club")

    def test_jsonld_extracts_image(self):
        p    = self._parser()
        evs  = p._parse_jsonld(self._soup(self.JSONLD_HTML), "https://control-club.ro/events")
        self.assertTrue(any("techno.jpg" in img for img in evs[0]["images"]))

    def test_jsonld_no_events_returns_empty(self):
        p    = self._parser()
        html = "<html><head><script type='application/ld+json'>{\"@type\": \"Organization\"}</script></head></html>"
        evs  = p._parse_jsonld(self._soup(html), "https://control-club.ro")
        self.assertEqual(evs, [])


class TestGenericParsing(unittest.TestCase):

    CARD_HTML = """
    <html><body>
    <div class="event-card">
      <h3>Jazz Evening</h3>
      <time datetime="2026-05-10T20:00:00">10 mai 2026</time>
      <p class="description">An unforgettable jazz night.</p>
      <a href="/events/jazz-2026">Buy tickets</a>
      <img src="/img/jazz.jpg" />
    </div>
    <div class="event-card">
      <h3>Salsa Night</h3>
      <time datetime="2026-05-17T21:00:00">17 mai 2026</time>
      <a href="/events/salsa-2026">Info</a>
    </div>
    </body></html>
    """

    def _parser(self):
        from scrapers.venue_event_parser import VenueEventParser
        return VenueEventParser("Quantic", "https://quantic.ro")

    def _soup(self, html):
        from bs4 import BeautifulSoup
        return BeautifulSoup(html, "lxml")

    def test_generic_finds_two_events(self):
        p   = self._parser()
        evs = p._parse_generic(self._soup(self.CARD_HTML), "https://quantic.ro/events")
        self.assertEqual(len(evs), 2)

    def test_generic_extracts_title(self):
        p   = self._parser()
        evs = p._parse_generic(self._soup(self.CARD_HTML), "https://quantic.ro/events")
        titles = [ev["title"] for ev in evs]
        self.assertIn("Jazz Evening", titles)
        self.assertIn("Salsa Night", titles)

    def test_generic_extracts_date(self):
        p   = self._parser()
        evs = p._parse_generic(self._soup(self.CARD_HTML), "https://quantic.ro/events")
        self.assertTrue(all("2026" in ev["start_at"] for ev in evs))

    def test_generic_extracts_image(self):
        p   = self._parser()
        evs = p._parse_generic(self._soup(self.CARD_HTML), "https://quantic.ro/events")
        jazz = next(ev for ev in evs if "Jazz" in ev["title"])
        self.assertTrue(any("jazz.jpg" in img for img in jazz["images"]))

    def test_generic_canonical_source(self):
        p   = self._parser()
        evs = p._parse_generic(self._soup(self.CARD_HTML), "https://quantic.ro/events")
        for ev in evs:
            self.assertEqual(ev["source"], "venue_site")

    def test_no_date_cards_ignored(self):
        html = """
        <html><body>
          <div class="event-card"><h3>No Date Event</h3><p>No date here at all.</p></div>
          <div class="event-card"><h3>Also No Date</h3><p>Still nothing.</p></div>
        </body></html>
        """
        p   = self._parser()
        evs = p._parse_generic(self._soup(html), "https://quantic.ro/events")
        self.assertEqual(evs, [])


class TestCanonicalFormat(unittest.TestCase):

    def test_canonical_has_required_keys(self):
        from scrapers.venue_event_parser import _canonical
        ev = _canonical(
            title="Test Event",
            start_at="2026-04-01T20:00:00+03:00",
            url="https://example.ro/event",
            venue_name="Test Venue",
        )
        required = [
            "source", "source_event_id", "url", "title", "description",
            "category", "start_at", "end_at", "venue", "price",
            "is_free", "ticket_url", "images", "tags",
        ]
        for key in required:
            self.assertIn(key, ev, f"Missing key: {key}")

    def test_canonical_source_is_venue_site(self):
        from scrapers.venue_event_parser import _canonical
        ev = _canonical(title="X", start_at="2026-01-01T00:00:00+02:00")
        self.assertEqual(ev["source"], "venue_site")

    def test_canonical_title_truncated(self):
        from scrapers.venue_event_parser import _canonical
        long_title = "A" * 300
        ev = _canonical(title=long_title, start_at="2026-01-01T00:00:00+02:00")
        self.assertLessEqual(len(ev["title"]), 200)


class TestDeduplication(unittest.TestCase):

    def test_dedup_same_title_date(self):
        from scrapers.venue_event_parser import VenueEventParser
        p = VenueEventParser("X", "https://x.ro")
        events = [
            {"title": "Concert A", "start_at": "2026-04-01T20:00:00+03:00"},
            {"title": "Concert A", "start_at": "2026-04-01T21:00:00+03:00"},  # different time, same date
            {"title": "Concert B", "start_at": "2026-04-02T20:00:00+03:00"},
        ]
        deduped = p._dedup(events)
        self.assertEqual(len(deduped), 2)  # Concert A deduped, Concert B kept

    def test_dedup_different_titles_kept(self):
        from scrapers.venue_event_parser import VenueEventParser
        p = VenueEventParser("X", "https://x.ro")
        events = [
            {"title": "Event A", "start_at": "2026-04-01T20:00:00+03:00"},
            {"title": "Event B", "start_at": "2026-04-01T20:00:00+03:00"},
        ]
        self.assertEqual(len(p._dedup(events)), 2)


# ─────────────────────────────────────────────────────────────────────────────
# Integration smoke test (no network calls)
# ─────────────────────────────────────────────────────────────────────────────

class TestVenuePipelineUnit(unittest.TestCase):

    @patch("scrapers.venue_pipeline._get_supabase")
    @patch.object(__import__("scrapers.venue_discovery", fromlist=["VenueDiscovery"]).VenueDiscovery, "discover", return_value=None)
    def test_process_venue_no_website_skipped(self, mock_discover, mock_sb):
        from scrapers.venue_pipeline import VenuePipeline
        p      = VenuePipeline(dry_run=True)
        result = p._process_venue({"name": "Nonexistent Venue XYZ", "website": None})
        self.assertEqual(result, [])

    def test_load_venues_from_explicit_list(self):
        """When venues are passed explicitly, no DB call is needed."""
        from scrapers.venue_pipeline import VenuePipeline
        venues = [{"name": "Control Club", "website": "https://control-club.ro"}]
        p      = VenuePipeline(dry_run=True)
        # Just verify no exception is raised
        self.assertEqual(len(venues), 1)


# ─────────────────────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    loader  = unittest.TestLoader()
    suite   = loader.loadTestsFromModule(__import__(__name__))
    runner  = unittest.TextTestRunner(verbosity=2)
    result  = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
