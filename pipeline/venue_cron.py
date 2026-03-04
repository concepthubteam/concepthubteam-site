"""
GOZI — Venue Discovery Cron
=============================

Scheduled runner for the Venue Discovery Engine.
Picks venues that haven't been crawled recently and refreshes their event pages.

USAGE:
    # Process up to 10 venues that haven't been crawled in 7 days
    python -m pipeline.venue_cron --limit 10 --stale-days 7

    # Force-crawl a specific venue
    python -m pipeline.venue_cron --venue "Control Club"

    # Discover websites but don't parse events (website discovery only)
    python -m pipeline.venue_cron --discovery-only --limit 20

    # Dry-run: no DB writes, no live crawl
    python -m pipeline.venue_cron --dry-run

SELECTION LOGIC:
    Venues are selected from the `venues` table where:
    1. website_crawled_at IS NULL  →  never crawled (highest priority)
    2. website_crawled_at < NOW() - INTERVAL '${stale_days} days'  →  stale
    Ordered by: never-crawled first, then most stale

COST CONTROLS:
    --limit N           max venues per cron run
    --max-pages N       max event pages to parse per venue

OBSERVABILITY:
    Prints a per-venue + total summary at the end.
    Writes venue_cron_failed.log if failures >= --alert-on-failures.

TIMEZONE:
    Europe/Bucharest for all time computations.
"""

from __future__ import annotations

import argparse
import logging
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# Timezone (reuse from tiktok_cron)
# ─────────────────────────────────────────────────────────────────────────────

try:
    from zoneinfo import ZoneInfo
    TZ_BUCHAREST = ZoneInfo("Europe/Bucharest")
except ImportError:
    try:
        import pytz
        TZ_BUCHAREST = pytz.timezone("Europe/Bucharest")
    except ImportError:
        TZ_BUCHAREST = timezone(timedelta(hours=2))


def _now_ro() -> datetime:
    return datetime.now(tz=TZ_BUCHAREST)


def _parse_dt(s: str) -> Optional[datetime]:
    if not s:
        return None
    s = s.replace("Z", "+00:00").replace(" ", "T")
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(TZ_BUCHAREST)
    except (ValueError, TypeError):
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("venue_cron")

ALERT_LOG = Path(__file__).parent.parent / "venue_cron_failed.log"

# ─────────────────────────────────────────────────────────────────────────────
# Supabase
# ─────────────────────────────────────────────────────────────────────────────

def _get_supabase():
    try:
        from supabase import create_client
        url = os.getenv("EXPO_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL", "")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        if not url or not key:
            raise EnvironmentError(
                "Missing EXPO_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"
            )
        return create_client(url, key)
    except ImportError:
        log.error("supabase-py not installed. Run: pip install supabase")
        sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# Venue selection
# ─────────────────────────────────────────────────────────────────────────────

def _select_stale_venues(
    sb,
    limit: int,
    stale_days: int,
    venue_filter: Optional[str],
) -> List[dict]:
    """
    Load venues that haven't been crawled within `stale_days`.
    Columns used: id, name, website, website_crawled_at
    If website_crawled_at column doesn't exist, falls back to all venues.
    """
    cutoff = (_now_ro() - timedelta(days=stale_days)).isoformat()

    try:
        q = sb.table("venues").select("id, name, website, website_crawled_at")
        if venue_filter:
            q = q.ilike("name", f"%{venue_filter}%")
        resp = q.limit(500).execute()
        rows = resp.data or []
    except Exception as exc:
        log.error("Failed to load venues: %s", exc)
        # Fallback — try without website_crawled_at
        try:
            q2 = sb.table("venues").select("id, name, website")
            if venue_filter:
                q2 = q2.ilike("name", f"%{venue_filter}%")
            resp2 = q2.limit(500).execute()
            rows = [dict(r, website_crawled_at=None) for r in (resp2.data or [])]
        except Exception as exc2:
            log.error("Fallback also failed: %s", exc2)
            return []

    stale: List[dict] = []
    for row in rows:
        crawled_str = row.get("website_crawled_at")
        if crawled_str is None:
            row["_staleness_s"] = float("inf")
            stale.append(row)
            continue
        crawled_dt = _parse_dt(crawled_str)
        if crawled_dt is None:
            row["_staleness_s"] = float("inf")
            stale.append(row)
            continue
        elapsed_s = (_now_ro() - crawled_dt).total_seconds()
        if elapsed_s >= stale_days * 86400:
            row["_staleness_s"] = elapsed_s
            stale.append(row)

    stale.sort(key=lambda r: r["_staleness_s"], reverse=True)
    log.info(
        "Venue selection: %d total → %d stale (>%dd) → taking up to %d",
        len(rows), len(stale), stale_days, limit,
    )
    return stale[:limit]


# ─────────────────────────────────────────────────────────────────────────────
# Mark crawled
# ─────────────────────────────────────────────────────────────────────────────

def _mark_crawled(sb, venue_id, website: Optional[str] = None):
    """Update website_crawled_at (and optionally website) for a venue."""
    try:
        update = {"website_crawled_at": _now_ro().isoformat()}
        if website:
            update["website"] = website
        sb.table("venues").update(update).eq("id", venue_id).execute()
    except Exception as exc:
        log.debug("Could not mark venue %s as crawled: %s", venue_id, exc)


# ─────────────────────────────────────────────────────────────────────────────
# Process single venue
# ─────────────────────────────────────────────────────────────────────────────

def _process_venue(
    venue: dict,
    sb,
    max_pages: int,
    discovery_only: bool,
    dry_run: bool,
) -> dict:
    """
    Full pipeline for one venue. Returns stats dict.
    """
    name    = (venue.get("name") or "").strip()
    website = (venue.get("website") or "").strip()
    vid     = venue.get("id")
    stats   = {
        "venue": name, "ok": False,
        "website_found": False, "pages": 0, "events": 0, "ingested": 0,
    }

    if not name:
        return stats

    # ── Step 1: Website discovery if missing ─────────────────────────────────
    if not website:
        try:
            from scrapers.venue_discovery import VenueDiscovery
            discovery = VenueDiscovery(
                google_api_key = os.getenv("GOOGLE_CSE_API_KEY"),
                google_cse_id  = os.getenv("GOOGLE_CSE_ID"),
                serpapi_key    = os.getenv("SERPAPI_KEY"),
            )
            website = discovery.discover(name)
        except Exception as exc:
            log.warning("  Discovery error for '%s': %s", name, exc)

        if website:
            log.info("  Discovered website: %s", website)
            stats["website_found"] = True
            if not dry_run and vid:
                _mark_crawled(sb, vid, website)
        else:
            log.info("  No website found for '%s'", name)
            return stats

    if discovery_only:
        stats["ok"] = bool(website)
        return stats

    # ── Step 2: Find + parse event pages ─────────────────────────────────────
    try:
        from scrapers.venue_scraper import VenueScraper
        scraper = VenueScraper()
        candidates = scraper.find_event_pages(website)
    except Exception as exc:
        log.warning("  Scrape error for %s: %s", website, exc)
        return stats

    stats["pages"] = min(len(candidates), max_pages)
    confirmed = candidates[:max_pages]

    log.info("  Crawling %d pages on %s", len(confirmed), website)

    from scrapers.venue_event_parser import VenueEventParser
    parser = VenueEventParser(venue_name=name, venue_website=website)
    all_events = []
    seen = set()

    for page_url in confirmed:
        try:
            evs = parser.parse_page(page_url)
            for ev in evs:
                key = (ev["title"].lower()[:40], (ev.get("start_at") or "")[:10])
                if key not in seen:
                    seen.add(key)
                    all_events.append(ev)
            if evs:
                log.info("  %s → %d events", page_url, len(evs))
            time.sleep(random.uniform(1.5, 3.0))
        except Exception as exc:
            log.warning("  Parse error %s: %s", page_url, exc)

    stats["events"] = len(all_events)

    # ── Step 3: Ingest ────────────────────────────────────────────────────────
    if all_events and not dry_run:
        try:
            from pipeline.ingest import ingest_batch
            result = ingest_batch(all_events, source_label="venue_site")
            stats["ingested"] = result.get("new", 0)
            log.info("  Ingested: %d new events", stats["ingested"])
        except Exception as exc:
            log.error("  Ingest error: %s", exc)

    if not dry_run and vid:
        _mark_crawled(sb, vid, website)

    stats["ok"] = True
    return stats


# ─────────────────────────────────────────────────────────────────────────────
# Main cron runner
# ─────────────────────────────────────────────────────────────────────────────

def run_venue_cron(
    limit: int = 10,
    stale_days: int = 7,
    max_pages: int = 5,
    venue_filter: Optional[str] = None,
    discovery_only: bool = False,
    dry_run: bool = False,
    alert_on_failures: int = 5,
) -> dict:
    """
    Main entry point — callable from run_daily.py or directly.
    Returns summary dict.
    """
    cron_t0 = time.perf_counter()
    log.info("═" * 60)
    log.info("  GOZI Venue Cron  —  %s", _now_ro().strftime("%Y-%m-%d %H:%M:%S %Z"))
    log.info("  limit=%d  stale_days=%d  max_pages=%d  dry_run=%s",
             limit, stale_days, max_pages, dry_run)
    log.info("═" * 60)

    sb = None if dry_run else _get_supabase()

    # Select venues to process
    if dry_run:
        log.info("[DRY-RUN] Skipping DB; no venues loaded")
        venues = []
    else:
        venues = _select_stale_venues(sb, limit, stale_days, venue_filter)

    if not venues:
        log.info("No venues due for refresh. Cron done.")
        return {
            "venues_due": 0, "processed": 0,
            "successes": 0, "failures": 0,
            "total_events": 0, "total_ingested": 0,
            "elapsed_s": round(time.perf_counter() - cron_t0, 2),
        }

    results: List[dict] = []

    for idx, venue in enumerate(venues):
        name = venue.get("name", "?")
        log.info("─" * 60)
        log.info("[%d/%d] %s", idx + 1, len(venues), name)
        t1 = time.perf_counter()

        try:
            stats = _process_venue(
                venue=venue,
                sb=sb,
                max_pages=max_pages,
                discovery_only=discovery_only,
                dry_run=dry_run,
            )
            stats["elapsed_s"] = round(time.perf_counter() - t1, 1)
        except Exception as exc:
            log.error("  Unexpected error for '%s': %s", name, exc, exc_info=True)
            stats = {"venue": name, "ok": False, "error": str(exc),
                     "events": 0, "ingested": 0, "elapsed_s": round(time.perf_counter() - t1, 1)}

        results.append(stats)

        if idx < len(venues) - 1:
            sleep_s = random.uniform(3.0, 6.0)
            log.debug("  Rate-limit sleep %.1fs", sleep_s)
            time.sleep(sleep_s)

    # Summary
    successes = sum(1 for r in results if r.get("ok"))
    failures  = sum(1 for r in results if not r.get("ok"))
    total_events   = sum(r.get("events", 0) for r in results)
    total_ingested = sum(r.get("ingested", 0) for r in results)
    elapsed = round(time.perf_counter() - cron_t0, 2)

    print()
    print("═" * 60)
    print("  Venue Cron — Summary")
    print("─" * 60)
    for r in results:
        icon = "✓" if r.get("ok") else "✗"
        detail = (
            f"pages={r.get('pages',0)}  events={r.get('events',0)}  "
            f"new={r.get('ingested',0)}  {r.get('elapsed_s',0):.1f}s"
        )
        if not r.get("ok") and r.get("error"):
            detail = f"ERROR: {r['error'][:50]}"
        print(f"  {icon}  {r.get('venue','?'):35s}  {detail}")
    print("─" * 60)
    print(
        f"  Venues: {len(results)} | ✓ {successes}  ✗ {failures} | "
        f"Events: {total_events}  Ingested: {total_ingested} | {elapsed}s"
    )
    print("═" * 60)

    if failures >= alert_on_failures:
        msg = (
            f"[{_now_ro().isoformat()}] venue_cron: "
            f"{failures} failures in run (threshold: {alert_on_failures})\n"
        )
        try:
            ALERT_LOG.open("a").write(msg)
            log.warning("⚠️  Alert written to %s", ALERT_LOG)
        except OSError:
            pass

    return {
        "venues_due": len(venues),
        "processed": len(results),
        "successes": successes,
        "failures": failures,
        "total_events": total_events,
        "total_ingested": total_ingested,
        "elapsed_s": elapsed,
    }


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(
        prog="venue_cron",
        description="GOZI Venue Discovery Cron — refreshes stale venue websites",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--limit",             type=int,   default=10,  help="Max venues per run (default: 10)")
    p.add_argument("--stale-days",        type=int,   default=7,   help="Stale threshold in days (default: 7)")
    p.add_argument("--max-pages",         type=int,   default=5,   help="Max event pages per venue (default: 5)")
    p.add_argument("--venue",             type=str,   default=None, help="Filter by venue name (partial match)")
    p.add_argument("--discovery-only",    action="store_true",      help="Only discover websites, don't parse events")
    p.add_argument("--dry-run",           action="store_true",      help="No DB writes, no live crawl")
    p.add_argument("--alert-on-failures", type=int,   default=5,   help="Alert threshold for failures (default: 5)")
    p.add_argument("--verbose", "-v",     action="store_true",      help="DEBUG logging")
    args = p.parse_args()

    if args.verbose:
        log.setLevel(logging.DEBUG)

    summary = run_venue_cron(
        limit=args.limit,
        stale_days=args.stale_days,
        max_pages=args.max_pages,
        venue_filter=args.venue,
        discovery_only=args.discovery_only,
        dry_run=args.dry_run,
        alert_on_failures=args.alert_on_failures,
    )
    sys.exit(0 if summary["failures"] == 0 else 1)


if __name__ == "__main__":
    main()
