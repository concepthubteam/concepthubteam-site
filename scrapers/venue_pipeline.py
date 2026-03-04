"""
GOZI — Venue Discovery Engine: Module 4 (Orchestrator)
Reads venues from DB → discovers websites → crawls event pages → ingests events.

Full pipeline flow:
  1. Load venues from Supabase (venues table or extracted from events)
  2. For each venue without a website: run VenueDiscovery
  3. Persist discovered website back to venues table
  4. For each website: find event pages (VenueScraper)
  5. Parse each candidate page (VenueEventParser)
  6. Feed results to pipeline/ingest.py → ingest_batch()

Usage:
  python -m scrapers.venue_pipeline

  # Override venue list (no DB read):
  python -m scrapers.venue_pipeline --venues "Control Club,Quantic,Expirat"

  # Dry-run (no DB writes):
  python -m scrapers.venue_pipeline --dry-run
"""

import logging
import os
import time
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Supabase helper
# ─────────────────────────────────────────────────────────────────────────────

def _get_supabase():
    from supabase import create_client
    url = os.getenv("EXPO_PUBLIC_SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise EnvironmentError("EXPO_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
    return create_client(url, key)


# ─────────────────────────────────────────────────────────────────────────────
# VenuePipeline
# ─────────────────────────────────────────────────────────────────────────────

class VenuePipeline:
    """
    Orchestrates: venue discovery → event page crawl → event parse → ingest.
    """

    def __init__(
        self,
        supabase=None,
        discovery=None,
        scraper=None,
        dry_run: bool = False,
        max_pages_per_venue: int = 5,
        inter_venue_delay:   float = 2.0,
    ):
        self.sb                   = supabase
        self._discovery           = discovery
        self._scraper             = scraper
        self.dry_run              = dry_run
        self.max_pages_per_venue  = max_pages_per_venue
        self.inter_venue_delay    = inter_venue_delay

    # ── Lazy-init helpers ─────────────────────────────────────────────────────

    @property
    def sb_(self):
        if self.sb is None:
            self.sb = _get_supabase()
        return self.sb

    @property
    def discovery(self):
        if self._discovery is None:
            from scrapers.venue_discovery import VenueDiscovery
            self._discovery = VenueDiscovery(
                google_api_key = os.getenv("GOOGLE_CSE_API_KEY"),
                google_cse_id  = os.getenv("GOOGLE_CSE_ID"),
                serpapi_key    = os.getenv("SERPAPI_KEY"),
            )
        return self._discovery

    @property
    def scraper(self):
        if self._scraper is None:
            from scrapers.venue_scraper import VenueScraper
            self._scraper = VenueScraper()
        return self._scraper

    # ── Step 1: Load venues ───────────────────────────────────────────────────

    def _load_venues(self, limit: int = 100) -> list:
        """
        Load venues from the `venues` table.
        Falls back to extracting distinct venue names from `events` if table empty.
        """
        try:
            resp = self.sb_.table("venues").select("id,name,website").limit(limit).execute()
            rows = resp.data or []
            if rows:
                log.info(f"Loaded {len(rows)} venues from venues table")
                return rows
        except Exception as e:
            log.warning(f"venues table read error: {e}")

        # Fallback: extract from events.venue_data JSONB column
        log.info("Falling back to extracting venues from events table …")
        try:
            resp = self.sb_.table("events").select("venue_data").limit(1000).execute()
            seen: dict = {}
            for row in (resp.data or []):
                vd   = row.get("venue_data") or {}
                name = (vd.get("name") or "").strip()
                if name and len(name) > 2 and name not in seen:
                    seen[name] = {"id": None, "name": name, "website": None}
            rows = list(seen.values())[:limit]
            log.info(f"Extracted {len(rows)} unique venue names from events")
            return rows
        except Exception as e:
            log.error(f"Could not load venues from events: {e}")
            return []

    # ── Step 2: Persist discovered website ────────────────────────────────────

    def _save_website(self, venue_id, website: str):
        if self.dry_run or not venue_id:
            return
        try:
            self.sb_.table("venues").update({"website": website}).eq("id", venue_id).execute()
            log.debug(f"Saved website for venue {venue_id}: {website}")
        except Exception as e:
            log.warning(f"Could not save website for venue {venue_id}: {e}")

    # ── Step 3–5: Process one venue ───────────────────────────────────────────

    def _process_venue(self, venue: dict) -> list:
        """
        Full pipeline for a single venue.
        Returns list of canonical event dicts.
        """
        name    = (venue.get("name") or "").strip()
        website = (venue.get("website") or "").strip()
        vid     = venue.get("id")

        if not name:
            return []

        log.info(f"▶  {name}")

        # ── Step 2: discover website if missing ───────────────────────────────
        if not website:
            website = self.discovery.discover(name)
            if website:
                log.info(f"   Discovered: {website}")
                self._save_website(vid, website)
            else:
                log.info(f"   No website found for '{name}'")
                return []

        # ── Step 3: find event pages ──────────────────────────────────────────
        try:
            candidates = self.scraper.find_event_pages(website)
        except Exception as e:
            log.warning(f"   Scrape error for {website}: {e}")
            return []

        log.info(f"   {len(candidates)} candidate pages on {website}")

        # ── Step 4: filter pages that likely have events ──────────────────────
        confirmed = []
        for page_url in candidates[:self.max_pages_per_venue * 2]:
            try:
                if self.scraper.page_has_events(page_url):
                    confirmed.append(page_url)
                    if len(confirmed) >= self.max_pages_per_venue:
                        break
            except Exception:
                pass

        if not confirmed:
            # Fallback: try all candidates up to max
            confirmed = candidates[:self.max_pages_per_venue]

        log.info(f"   Parsing {len(confirmed)} confirmed event pages")

        # ── Step 5: parse events ──────────────────────────────────────────────
        from scrapers.venue_event_parser import VenueEventParser
        parser    = VenueEventParser(venue_name=name, venue_website=website)
        all_evs   = []
        seen_keys = set()

        for page_url in confirmed:
            try:
                evs = parser.parse_page(page_url)
                for ev in evs:
                    key = (ev["title"].lower()[:40], (ev.get("start_at") or "")[:10])
                    if key not in seen_keys:
                        seen_keys.add(key)
                        all_evs.append(ev)
                if evs:
                    log.info(f"   {page_url}: {len(evs)} events")
                time.sleep(self.scraper.delay)
            except Exception as e:
                log.warning(f"   Parse error {page_url}: {e}")

        log.info(f"   → {len(all_evs)} unique events for '{name}'")
        return all_evs

    # ── Main run ──────────────────────────────────────────────────────────────

    def run(
        self,
        venues:          Optional[list] = None,
        limit:           int            = 50,
        ingest:          bool           = True,
    ) -> dict:
        """
        Run the full pipeline.

        Args:
            venues:  Explicit list of {name, website} dicts. If None, load from DB.
            limit:   Max venues to process (ignored when venues is provided).
            ingest:  Whether to send events to ingest pipeline.

        Returns:
            Stats dict.
        """
        t0    = time.time()
        stats = {
            "total_venues":  0,
            "scraped":       0,
            "events_found":  0,
            "ingested_new":  0,
            "ingested_merged": 0,
            "errors":        0,
        }

        if venues is None:
            venues = self._load_venues(limit=limit)

        stats["total_venues"] = len(venues)
        all_events: list = []

        for i, venue in enumerate(venues, 1):
            log.info(f"[{i}/{len(venues)}] Processing: {venue.get('name')}")
            try:
                evs = self._process_venue(venue)
                all_events.extend(evs)
                stats["events_found"] += len(evs)
                stats["scraped"]      += 1
            except Exception as e:
                log.error(f"Error processing venue '{venue.get('name')}': {e}", exc_info=True)
                stats["errors"] += 1

            time.sleep(self.inter_venue_delay)

        # ── Ingest ────────────────────────────────────────────────────────────
        if ingest and all_events and not self.dry_run:
            try:
                from pipeline.ingest import ingest_batch
                ingest_stats = ingest_batch(all_events, source_label="venue_site")
                stats["ingested_new"]    = ingest_stats.get("new",    0)
                stats["ingested_merged"] = ingest_stats.get("merged", 0)
                log.info(f"Ingest result: {ingest_stats}")
            except Exception as e:
                log.error(f"Ingest error: {e}", exc_info=True)

        stats["elapsed_s"] = round(time.time() - t0, 1)
        log.info(f"VenuePipeline finished: {stats}")
        return stats


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    import json

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )

    ap = argparse.ArgumentParser(description="GOZI Venue Discovery Pipeline")
    ap.add_argument("--venues",    type=str, default="", help="Comma-separated venue names")
    ap.add_argument("--limit",     type=int, default=20,  help="Max venues from DB")
    ap.add_argument("--dry-run",   action="store_true",    help="No DB writes or ingestion")
    ap.add_argument("--no-ingest", action="store_true",    help="Skip ingestion step")
    args = ap.parse_args()

    venues = None
    if args.venues:
        venues = [{"name": n.strip(), "website": None} for n in args.venues.split(",") if n.strip()]

    pipeline = VenuePipeline(dry_run=args.dry_run)
    stats    = pipeline.run(
        venues=venues,
        limit=args.limit,
        ingest=not args.no_ingest,
    )

    print(f"\n{'='*50}")
    print(json.dumps(stats, indent=2))
