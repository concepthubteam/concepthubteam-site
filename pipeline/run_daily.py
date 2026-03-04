"""
GOZI Daily Ingestion Pipeline — Master Orchestrator
=====================================================

Runs all data sources in order:
  1. Ticketing scrapers   (Eventbook, iaBilet, RA.co, ZilesiNopti, Iesim)
  2. Venue Discovery      (scrapers.venue_pipeline)  — weekly, configurable
  3. TikTok Cron          (pipeline.tiktok_cron)     — always, cost-controlled

Usage:
    # Full daily run (all scrapers + TikTok cron):
    python -m pipeline.run_daily

    # Only ticketing scrapers:
    python -m pipeline.run_daily --scrapers-only

    # Skip ticketing scrapers (TikTok + venues only):
    python -m pipeline.run_daily --skip-scrapers

    # Dry-run (no DB writes):
    python -m pipeline.run_daily --dry-run

Cron examples:
    # Daily at 06:00 Europe/Bucharest
    0 6 * * * cd /path/to/gozi-app && python -m pipeline.run_daily >> logs/daily.log 2>&1

    # TikTok every hour (cheap: max 5 accounts, 5 videos):
    0 * * * * cd /path/to/gozi-app && python -m pipeline.tiktok_cron --limit 5 --max-videos 5

Env vars needed (in .env):
    EXPO_PUBLIC_SUPABASE_URL     or SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
    APIFY_API_TOKEN              (for TikTok — optional, stubs without it)
    GOOGLE_CSE_API_KEY           (for Venue Discovery — optional)
    GOOGLE_CSE_ID                (for Venue Discovery — optional)
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import datetime

from dotenv import load_dotenv

# Allow running from project root: python -m pipeline.run_daily
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Scrapers
# ─────────────────────────────────────────────────────────────────────────────

def _get_scrapers():
    from scrapers.eventbook_scraper   import EventbookScraper
    from scrapers.iabilet_scraper     import IabiletScraper
    from scrapers.ra_scraper          import RaScraper
    from scrapers.zilesinopti_scraper import ZilesiNoptiScraper
    from scrapers.iesim_scraper       import IesimScraper
    from scrapers.hardpedia_scraper   import HardpediaScraper

    return [
        EventbookScraper(max_pages=20),
        IabiletScraper(max_pages=15),
        RaScraper(days_ahead=90),
        ZilesiNoptiScraper(max_pages_per_section=3),
        IesimScraper(max_pages=10),
        HardpediaScraper(max_pages=3),
    ]


def _run_scrapers(dry_run: bool = False) -> dict:
    """Run all ticketing scrapers and ingest results."""
    from pipeline.ingest import ingest_batch

    totals = {"new": 0, "merged": 0, "error": 0, "total": 0}
    t0 = time.perf_counter()

    log.info("─" * 60)
    log.info("  Phase 1: Ticketing Scrapers")
    log.info("─" * 60)

    for scraper in _get_scrapers():
        log.info("▶  [%s] scraping…", scraper.source)
        t1 = time.perf_counter()
        try:
            events = scraper.run()
        except Exception as exc:
            log.error("  [%s] scraper error: %s", scraper.source, exc, exc_info=True)
            totals["error"] += 1
            continue

        if not events:
            log.warning("  [%s] 0 events — skipping ingest", scraper.source)
            continue

        log.info("  [%s] %d events — ingesting…", scraper.source, len(events))

        if dry_run:
            log.info("  [%s] [DRY-RUN] skipping ingest", scraper.source)
            continue

        try:
            stats = ingest_batch(events, source_label=scraper.source)
            elapsed = time.perf_counter() - t1
            log.info(
                "  [%s] done in %.1fs: new=%d merged=%d error=%d",
                scraper.source, elapsed,
                stats["new"], stats["merged"], stats["error"],
            )
            for k in totals:
                totals[k] += stats.get(k, 0)
        except Exception as exc:
            log.error("  [%s] ingest error: %s", scraper.source, exc, exc_info=True)
            totals["error"] += 1

    totals["elapsed_s"] = round(time.perf_counter() - t0, 1)
    return totals


# ─────────────────────────────────────────────────────────────────────────────
# Venue Discovery
# ─────────────────────────────────────────────────────────────────────────────

def _run_venue_discovery(limit: int = 10, dry_run: bool = False) -> dict:
    """
    Run the Venue Discovery Pipeline for up to `limit` venues.
    This is slow (web crawling) — meant to run weekly, not daily.
    """
    log.info("─" * 60)
    log.info("  Phase 2: Venue Discovery Pipeline")
    log.info("─" * 60)
    t0 = time.perf_counter()

    try:
        from scrapers.venue_pipeline import VenuePipeline
        pipeline = VenuePipeline(dry_run=dry_run)
        stats = pipeline.run(limit=limit, ingest=not dry_run)
        stats["elapsed_s"] = round(time.perf_counter() - t0, 1)
        log.info(
            "  Venue discovery: %d venues → %d events found (%d new, %.1fs)",
            stats.get("scraped", 0),
            stats.get("events_found", 0),
            stats.get("ingested_new", 0),
            stats.get("elapsed_s", 0),
        )
        return stats
    except Exception as exc:
        log.error("  Venue discovery failed: %s", exc, exc_info=True)
        return {"error": str(exc), "elapsed_s": round(time.perf_counter() - t0, 1)}


# ─────────────────────────────────────────────────────────────────────────────
# TikTok Cron
# ─────────────────────────────────────────────────────────────────────────────

def _run_tiktok_cron(
    limit: int = 20,
    max_videos: int = 10,
    dry_run: bool = False,
) -> dict:
    """Run the TikTok ingestion scheduler."""
    log.info("─" * 60)
    log.info("  Phase 3: TikTok Cron")
    log.info("─" * 60)
    t0 = time.perf_counter()

    try:
        from pipeline.tiktok_cron import run_cron
        stats = run_cron(
            limit=limit,
            max_videos=max_videos,
            dry_run=dry_run,
            alert_on_failures=5,
        )
        stats["elapsed_s"] = round(time.perf_counter() - t0, 1)
        return stats
    except Exception as exc:
        log.error("  TikTok cron failed: %s", exc, exc_info=True)
        return {"error": str(exc), "elapsed_s": round(time.perf_counter() - t0, 1)}


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="GOZI Daily Pipeline — master orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--scrapers-only",   action="store_true", help="Only run ticketing scrapers")
    ap.add_argument("--skip-scrapers",   action="store_true", help="Skip ticketing scrapers")
    ap.add_argument("--skip-venues",     action="store_true", help="Skip venue discovery (default: skip)")
    ap.add_argument("--run-venues",      action="store_true", help="Run venue discovery (slow — use weekly)")
    ap.add_argument("--skip-tiktok",     action="store_true", help="Skip TikTok cron")
    ap.add_argument("--venue-limit",     type=int, default=10,  help="Max venues for discovery (default: 10)")
    ap.add_argument("--tiktok-limit",    type=int, default=20,  help="Max TikTok accounts per run (default: 20)")
    ap.add_argument("--tiktok-videos",   type=int, default=10,  help="Max videos per TikTok account (default: 10)")
    ap.add_argument("--dry-run",         action="store_true",   help="No DB writes")
    ap.add_argument("--verbose", "-v",   action="store_true",   help="DEBUG logging")
    args = ap.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Validate env
    supabase_url = (
        os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or
        os.environ.get("SUPABASE_URL") or
        ""
    )
    if not supabase_url and not args.dry_run:
        log.error(
            "Supabase URL not set. "
            "Add EXPO_PUBLIC_SUPABASE_URL to your .env file."
        )
        sys.exit(1)

    # ── Header ────────────────────────────────────────────────────────────────
    print()
    print("═" * 60)
    print(f"  GOZI Daily Pipeline — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    if args.dry_run:
        print("  [DRY-RUN MODE — no DB writes]")
    print("═" * 60)

    total_t0 = time.perf_counter()
    all_stats: dict = {}

    # ── Phase 1: Ticketing scrapers ───────────────────────────────────────────
    if not args.skip_scrapers:
        scraper_stats = _run_scrapers(dry_run=args.dry_run)
        all_stats["scrapers"] = scraper_stats
    else:
        log.info("Phase 1 skipped (--skip-scrapers)")

    if args.scrapers_only:
        # Print summary and exit early
        _print_summary(all_stats, time.perf_counter() - total_t0)
        return

    # ── Phase 2: Venue Discovery (opt-in — slow) ─────────────────────────────
    if args.run_venues and not args.skip_venues:
        venue_stats = _run_venue_discovery(
            limit=args.venue_limit,
            dry_run=args.dry_run,
        )
        all_stats["venues"] = venue_stats
    else:
        log.info("Phase 2 skipped (venue discovery — use --run-venues to enable)")

    # ── Phase 3: TikTok cron ──────────────────────────────────────────────────
    if not args.skip_tiktok:
        tiktok_stats = _run_tiktok_cron(
            limit=args.tiktok_limit,
            max_videos=args.tiktok_videos,
            dry_run=args.dry_run,
        )
        all_stats["tiktok"] = tiktok_stats
    else:
        log.info("Phase 3 skipped (--skip-tiktok)")

    # ── Final summary ─────────────────────────────────────────────────────────
    _print_summary(all_stats, time.perf_counter() - total_t0)


def _print_summary(all_stats: dict, total_elapsed: float):
    print()
    print("═" * 60)
    print("  GOZI Daily Pipeline — Summary")
    print("─" * 60)

    if "scrapers" in all_stats:
        s = all_stats["scrapers"]
        print(
            f"  Scrapers:  total={s.get('total',0)}  "
            f"new={s.get('new',0)}  merged={s.get('merged',0)}  "
            f"error={s.get('error',0)}  ({s.get('elapsed_s',0):.1f}s)"
        )

    if "venues" in all_stats:
        s = all_stats["venues"]
        if "error" in s:
            print(f"  Venues:    ERROR — {s['error'][:60]}")
        else:
            print(
                f"  Venues:    scraped={s.get('scraped',0)}  "
                f"events={s.get('events_found',0)}  "
                f"new={s.get('ingested_new',0)}  ({s.get('elapsed_s',0):.1f}s)"
            )

    if "tiktok" in all_stats:
        s = all_stats["tiktok"]
        if "error" in s:
            print(f"  TikTok:    ERROR — {s['error'][:60]}")
        else:
            print(
                f"  TikTok:    processed={s.get('accounts_processed',0)}  "
                f"✓{s.get('successes',0)} ✗{s.get('failures',0)} "
                f"⏭{s.get('skipped',0)}  "
                f"videos={s.get('total_videos',0)}  "
                f"signals={s.get('total_signals',0)}  ({s.get('elapsed_s',0):.1f}s)"
            )

    print("─" * 60)
    print(f"  Total elapsed: {total_elapsed:.1f}s")
    print("═" * 60)
    print()


if __name__ == "__main__":
    main()
