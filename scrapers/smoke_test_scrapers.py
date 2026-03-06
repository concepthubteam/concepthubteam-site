"""
GOZI — Scrapers Smoke Test
===========================
Runs each scraper module live (with real network calls) and verifies that:
  • events_found > 0 for each source
  • Each event dict has the required canonical keys
  • Prints 3 sample events per source for quick visual inspection

Exit code 0 → all scrapers returned events
Exit code 1 → one or more scrapers returned 0 events or raised an error

Usage:
    cd /Users/remusenus/Desktop/gozi-app
    python scrapers/smoke_test_scrapers.py
    python scrapers/smoke_test_scrapers.py --source iabilet   # single scraper
    python scrapers/smoke_test_scrapers.py --fast             # smaller page limits
    python scrapers/smoke_test_scrapers.py --no-samples       # skip sample printing
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import textwrap
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_GREEN  = "\033[32m"
_RED    = "\033[31m"
_YELLOW = "\033[33m"
_BOLD   = "\033[1m"
_CYAN   = "\033[36m"
_RESET  = "\033[0m"

# Canonical keys every event dict must contain
REQUIRED_KEYS = {"title", "source"}

# Keys that are highly desirable (warn if missing, don't fail)
DESIRABLE_KEYS = {"date_iso", "venue", "price", "url", "image"}

# ─────────────────────────────────────────────────────────────────────────────
# Scraper registry  (name → factory that returns an instance)
# ─────────────────────────────────────────────────────────────────────────────

def _build_scrapers(fast: bool) -> list[tuple[str, Any]]:
    """Return [(source_label, scraper_instance), …]"""
    pairs = []

    # EventBook
    try:
        from scrapers.eventbook_scraper import EventbookScraper
        pairs.append(("eventbook", EventbookScraper(max_pages=2 if fast else 5)))
    except Exception as exc:
        pairs.append(("eventbook", exc))

    # IaBilet
    try:
        from scrapers.iabilet_scraper import IabiletScraper
        pairs.append(("iabilet", IabiletScraper(max_pages=2 if fast else 5)))
    except Exception as exc:
        pairs.append(("iabilet", exc))

    # Resident Advisor
    try:
        from scrapers.ra_scraper import RaScraper
        pairs.append(("ra", RaScraper(days_ahead=30 if fast else 90)))
    except Exception as exc:
        pairs.append(("ra", exc))

    # ZilesiNopti
    try:
        from scrapers.zilesinopti_scraper import ZilesiNoptiScraper
        pairs.append(("zilesinopti", ZilesiNoptiScraper(max_pages_per_section=1 if fast else 3)))
    except Exception as exc:
        pairs.append(("zilesinopti", exc))

    # Iesim
    try:
        from scrapers.iesim_scraper import IesimScraper
        pairs.append(("iesim", IesimScraper(max_pages=2 if fast else 5)))
    except Exception as exc:
        pairs.append(("iesim", exc))

    # Hardpedia
    try:
        from scrapers.hardpedia_scraper import HardpediaScraper
        pairs.append(("hardpedia", HardpediaScraper(max_pages=1 if fast else 3)))
    except Exception as exc:
        pairs.append(("hardpedia", exc))

    return pairs


# ─────────────────────────────────────────────────────────────────────────────
# Printing helpers
# ─────────────────────────────────────────────────────────────────────────────

def _print_sample(ev: dict, idx: int) -> None:
    title   = ev.get("title", "—")[:70]
    date    = ev.get("date_iso") or ev.get("start_at") or "?"
    venue   = ev.get("venue") or ev.get("venue_name") or "?"
    price   = ev.get("price", "?")
    url     = (ev.get("url") or ev.get("tickets_url") or "")[:60]
    source  = ev.get("source", "?")

    print(f"      {_CYAN}[{idx}]{_RESET} {title}")
    print(f"           date={date}  venue={venue!r}  price={price}")
    if url:
        print(f"           url={url}")
    print()


def _check_keys(ev: dict) -> tuple[list[str], list[str]]:
    """Return (missing_required, missing_desirable)."""
    missing_req  = [k for k in REQUIRED_KEYS  if k not in ev or ev[k] is None]
    missing_des  = [k for k in DESIRABLE_KEYS if k not in ev or ev[k] is None]
    return missing_req, missing_des


# ─────────────────────────────────────────────────────────────────────────────
# Per-scraper run
# ─────────────────────────────────────────────────────────────────────────────

def _run_one(label: str, scraper: Any, show_samples: bool) -> dict:
    """Run a single scraper and return a result dict."""
    print(f"\n  {'─' * 54}")
    print(f"  {_BOLD}▶  {label.upper()}{_RESET}")

    if isinstance(scraper, Exception):
        print(f"  {_RED}IMPORT ERROR: {scraper}{_RESET}")
        return {"label": label, "status": "import_error", "events": 0, "error": str(scraper)}

    t0 = time.perf_counter()
    try:
        events = scraper.run()
    except Exception as exc:
        elapsed = time.perf_counter() - t0
        print(f"  {_RED}SCRAPER ERROR ({elapsed:.1f}s): {exc}{_RESET}")
        return {"label": label, "status": "scraper_error", "events": 0, "error": str(exc)}

    elapsed = time.perf_counter() - t0

    if not events:
        print(f"  {_RED}✗  0 events returned in {elapsed:.1f}s{_RESET}")
        print(f"  {_YELLOW}⚠  LIKELY SELECTOR BREAKAGE — check HTML structure manually{_RESET}")
        return {"label": label, "status": "empty", "events": 0, "elapsed": elapsed}

    count = len(events)
    print(f"  {_GREEN}✓  {count} events returned in {elapsed:.1f}s{_RESET}")

    # Key validation
    all_missing_req: list[str] = []
    all_missing_des: set[str]  = set()
    for ev in events:
        mr, md = _check_keys(ev)
        all_missing_req.extend(mr)
        all_missing_des.update(md)

    if all_missing_req:
        print(f"  {_RED}⚠  REQUIRED keys missing in some events: "
              f"{sorted(set(all_missing_req))}{_RESET}")
    if all_missing_des:
        print(f"  {_YELLOW}⚠  Desirable keys absent in some events: "
              f"{sorted(all_missing_des)}{_RESET}")

    # Samples
    if show_samples:
        print(f"\n    {_BOLD}── 3 sample events ──{_RESET}")
        for i, ev in enumerate(events[:3], 1):
            _print_sample(ev, i)

    return {
        "label":           label,
        "status":          "ok" if not all_missing_req else "key_error",
        "events":          count,
        "elapsed":         elapsed,
        "missing_req":     sorted(set(all_missing_req)),
        "missing_des":     sorted(all_missing_des),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(
        description="GOZI Scrapers Smoke Test",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--source",     help="Run only this scraper (e.g. iabilet, ra, …)")
    ap.add_argument("--fast",       action="store_true", help="Reduce page limits for speed")
    ap.add_argument("--no-samples", action="store_true", help="Skip sample event printing")
    args = ap.parse_args()

    print(f"\n{'═' * 58}")
    print(f"  GOZI Scrapers Smoke Test")
    if args.fast:
        print(f"  {_YELLOW}[FAST MODE — reduced page limits]{_RESET}")
    print(f"{'═' * 58}")

    scrapers = _build_scrapers(fast=args.fast)

    if args.source:
        scrapers = [(lbl, sc) for lbl, sc in scrapers if lbl == args.source.lower()]
        if not scrapers:
            print(f"{_RED}Unknown source '{args.source}'. "
                  f"Available: eventbook, iabilet, ra, zilesinopti, iesim, hardpedia{_RESET}")
            return 1

    results = []
    for label, scraper in scrapers:
        result = _run_one(label, scraper, show_samples=not args.no_samples)
        results.append(result)

    # ── Summary ──
    print(f"\n{'═' * 58}")
    print(f"  {_BOLD}Summary{_RESET}")
    print(f"{'─' * 58}")

    total_events = 0
    failed_sources: list[str] = []

    for r in results:
        status = r["status"]
        events = r.get("events", 0)
        elapsed = r.get("elapsed", 0)
        total_events += events

        if status == "ok":
            icon = f"{_GREEN}✓{_RESET}"
        elif status in ("empty", "scraper_error", "import_error"):
            icon = f"{_RED}✗{_RESET}"
            failed_sources.append(r["label"])
        else:  # key_error
            icon = f"{_YELLOW}⚠{_RESET}"
            failed_sources.append(r["label"])

        extra = ""
        if r.get("missing_req"):
            extra += f"  {_RED}missing: {r['missing_req']}{_RESET}"
        if r.get("error"):
            extra += f"  {_RED}{r['error'][:60]}{_RESET}"

        print(f"  {icon}  {r['label']:<18}  {events:>5} events  {elapsed:.1f}s{extra}")

    print(f"{'─' * 58}")
    print(f"  Total events: {total_events}")

    if not failed_sources:
        print(f"  {_GREEN}{_BOLD}ALL SCRAPERS OK ✓{_RESET}")
        exit_code = 0
    else:
        print(f"  {_RED}{_BOLD}FAILED: {', '.join(failed_sources)}{_RESET}")
        print(f"  {_YELLOW}Hint: check selector breakage, network access, or site structure changes.{_RESET}")
        exit_code = 1

    print(f"{'═' * 58}\n")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
