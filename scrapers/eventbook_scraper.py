"""
GOZI Scraper — Eventbook.ro Bucharest
Uses the /events JSON REST API (discovered 2026-03).
Fetches upcoming Bucharest events across all categories.

API endpoint: https://eventbook.ro/events
Params: category_id, filters=upcoming, per_page=100, page=N
Response: {"events": {"ID": {...}, ...}, "nextPage": "events?page=2" or null}
"""

import logging
import time
from datetime import datetime
from typing import List, Optional

import requests

from scrapers.base import BaseScraper
from pipeline.normalize import parse_price, map_category

log = logging.getLogger(__name__)

BASE_URL = "https://eventbook.ro"
API_URL  = f"{BASE_URL}/events"
HEADERS  = {
    "User-Agent":       "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept":           "application/json, text/javascript, */*; q=0.01",
    "Accept-Language":  "ro-RO,ro;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
    "Referer":          "https://eventbook.ro/music",
}

# Category IDs → URL slug (confirmed by browser network analysis, 2026-03)
CATEGORIES = {
    1: "music",
    2: "sport",
    3: "teatru",
    4: "alte-evenimente",
    5: "film",
    6: "copii-familie",
}


class EventbookScraper(BaseScraper):
    source = "eventbook"

    def __init__(self, max_pages: int = 10):
        self.max_pages = max_pages

    # ──────────────────────────────────────────────────────────────────────────
    def _fetch_category(self, cat_id: int, cat_slug: str) -> List[dict]:
        events = []
        for page in range(1, self.max_pages + 1):
            params = {
                "category_id": cat_id,
                "filters":     "upcoming",
                "per_page":    100,
                "page":        page,
            }
            try:
                r = requests.get(API_URL, params=params, headers=HEADERS, timeout=15)
                r.raise_for_status()
                data = r.json()
            except Exception as e:
                log.error(f"Eventbook cat={cat_id} page={page}: {e}")
                break

            raw_events = data.get("events") or {}
            if not raw_events:
                break

            for ev in raw_events.values():
                # Keep only Bucharest events
                if ev.get("city_slug") != "bucuresti":
                    continue
                parsed = self._parse_event(ev, cat_slug)
                if parsed:
                    events.append(parsed)

            if not data.get("nextPage"):
                break
            time.sleep(0.4)

        return events

    # ──────────────────────────────────────────────────────────────────────────
    def _parse_event(self, ev: dict, cat_slug: str) -> Optional[dict]:
        title = (ev.get("title") or "").strip()
        if not title:
            return None

        event_slug = ev.get("event_slug") or ""
        event_id   = str(ev.get("id") or "")
        # event_slug already contains the full path: "/music/bilete-slug"
        source_url = (
            f"{BASE_URL}{event_slug}"
            if event_slug.startswith("/") else
            f"{BASE_URL}/{cat_slug}/bilete-{event_slug}"
            if event_slug else BASE_URL
        )

        # Parse starting_date: "YYYY-MM-DD HH:MM:SS" or ISO-like
        start_raw    = ev.get("starting_date") or ev.get("starting_at") or ""
        start_at     = None
        time_display = None
        if start_raw:
            try:
                clean = str(start_raw).replace(" ", "T").split(".")[0]
                dt           = datetime.fromisoformat(clean)
                start_at     = dt.date().isoformat()
                time_display = dt.strftime("%H:%M") if (dt.hour or dt.minute) else None
            except (ValueError, TypeError):
                date_part = str(start_raw)[:10]
                if len(date_part) == 10:
                    start_at = date_part

        if not start_at:
            return None

        # Image — prefer highest quality
        image_url = (
            ev.get("image")
            or ev.get("image_2x")
            or ev.get("image_small_2x")
            or ev.get("image_small")
        )

        tags_raw = ev.get("tags") or []
        if isinstance(tags_raw, str):
            tags_raw = [t.strip() for t in tags_raw.split(",") if t.strip()]
        tags = [str(t).lower()[:50] for t in tags_raw][:8]

        venue_name = (ev.get("hall_name") or "București").strip()[:120]
        category   = map_category(f"{title} {cat_slug} {' '.join(tags)}")

        return {
            "source":          "eventbook",
            "source_event_id": f"eb_{event_id or abs(hash(source_url))}",
            "url":             source_url,
            "title":           title[:200],
            "description":     ((ev.get("subtitle") or "").strip() or None),
            "category":        category,
            "start_at":        start_at,
            "end_at":          None,
            "time_display":    time_display,
            "venue": {
                "name":            venue_name,
                "address":         f"{venue_name}, București",
                "lat":             None,
                "lng":             None,
                "google_place_id": None,
            },
            "price":      {"min": None, "max": None, "currency": "RON"},
            "is_free":    False,
            "ticket_url": source_url,
            "images":     [image_url] if image_url else [],
            "tags":       tags,
        }

    # ──────────────────────────────────────────────────────────────────────────
    def fetch(self) -> List[dict]:
        seen   = set()
        events = []
        for cat_id, cat_slug in CATEGORIES.items():
            batch = self._fetch_category(cat_id, cat_slug)
            new   = 0
            for ev in batch:
                key = ev["source_event_id"]
                if key not in seen:
                    seen.add(key)
                    events.append(ev)
                    new += 1
            log.info(f"  Eventbook cat={cat_id} ({cat_slug}): +{new}")
            time.sleep(0.3)
        return events


# ──────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    import json, sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    evs = EventbookScraper().run()
    print(f"\nTotal: {len(evs)}")
    if evs:
        print(json.dumps(evs[0], indent=2, ensure_ascii=False))
