"""
GOZI Scraper — RA.co (Resident Advisor) Bucharest
Outputs canonical event format for pipeline/ingest.py.

GraphQL schema verified 2026-03-04:
  - filter.date (not dateFrom/dateTo) → DateRangeFilterInputDtoInput { gte, lte }
  - sort arg: SortInputDtoInput { eventDate: { order: ASC, priority: 1 } }
  - Venue.location { latitude longitude }  (not lat/lng)
  - No isFree field — derive from cost being empty
  - images { filename }  ✓
"""

import logging
import re
import time
from datetime import datetime, timedelta
from typing import List, Optional

import pytz
import requests

from scrapers.base import BaseScraper

log          = logging.getLogger(__name__)
RA_GRAPHQL   = "https://ra.co/graphql"
BUCHAREST_TZ = pytz.timezone("Europe/Bucharest")
RA_AREA_ID   = 381   # Bucharest (verified: area(areaUrlName:"bucharest", countryUrlCode:"ro"))

HEADERS = {
    "Content-Type": "application/json",
    "User-Agent":   "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Referer":      "https://ra.co/",
    "Origin":       "https://ra.co",
}

RA_QUERY = """
query GET_EVENT_LISTINGS($filters: FilterInputDtoInput, $pageSize: Int, $page: Int) {
  eventListings(filters: $filters, pageSize: $pageSize, page: $page) {
    data {
      id
      listingDate
      event {
        id title date startTime endTime cost contentUrl
        images { filename }
        venue { name address location { latitude longitude } }
        artists { name }
        genres  { name }
        pick    { blurb }
      }
    }
    totalResults
  }
}
"""


class RaScraper(BaseScraper):
    source = "ra"

    def __init__(self, days_ahead: int = 90):
        self.days_ahead = days_ahead

    def _parse_price(self, cost_str: Optional[str]) -> tuple:
        if not cost_str:
            return None, None, "RON"
        # Derive is_free from empty/free string
        if re.search(r"\bfree\b|\bgratis\b", cost_str, re.I):
            return 0.0, 0.0, "RON"
        nums = re.findall(r"[\d.]+", cost_str)
        if not nums:
            return None, None, "RON"
        vals     = [float(n) for n in nums]
        currency = "EUR" if ("€" in cost_str or "eur" in cost_str.lower()) else "RON"
        return min(vals), max(vals), currency

    def _parse_item(self, listing: dict) -> Optional[dict]:
        ev = listing.get("event")
        if not ev:
            return None

        date_raw = ev.get("date") or listing.get("listingDate") or ""
        # Normalize: "2026-03-06T00:00:00.000" → "2026-03-06"
        date_str = date_raw[:10] if date_raw else ""
        if not date_str or len(date_str) < 10:
            return None

        # startTime may be "2026-03-06T22:00:00.000" or "22:00"
        start_time_raw = ev.get("startTime") or "22:00"
        if "T" in start_time_raw:
            time_str = start_time_raw.split("T")[1][:5]  # "22:00"
        else:
            time_str = start_time_raw[:5]

        try:
            start_naive = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
            start_at    = BUCHAREST_TZ.localize(start_naive).isoformat()
        except ValueError:
            return None

        end_at = None
        if ev.get("endTime"):
            try:
                end_t     = ev["endTime"][:5]
                end_naive = datetime.strptime(f"{date_str} {end_t}", "%Y-%m-%d %H:%M")
                if end_naive < start_naive:
                    end_naive += timedelta(days=1)
                end_at = BUCHAREST_TZ.localize(end_naive).isoformat()
            except ValueError:
                pass

        venue     = ev.get("venue") or {}
        location  = venue.get("location") or {}
        p_min, p_max, currency = self._parse_price(ev.get("cost"))
        is_free   = p_min == 0.0 and p_max == 0.0

        images = []
        for img in ev.get("images") or []:
            fname = img.get("filename") or ""
            if fname:
                images.append(
                    fname if fname.startswith("http")
                    else f"https://static.ra.co/images/events/flyer/{fname}"
                )

        content_url = ev.get("contentUrl") or ""
        event_url   = f"https://ra.co{content_url}" if content_url.startswith("/") else content_url

        genres  = [g["name"].lower() for g in (ev.get("genres")  or [])]
        artists = [a["name"]         for a in (ev.get("artists") or [])]
        blurb   = (ev.get("pick") or {}).get("blurb")
        desc    = blurb or (f"Artiști: {', '.join(artists)}" if artists else None)

        return {
            "source":          "ra",
            "source_event_id": f"ra_{ev.get('id')}",
            "url":             event_url,
            "title":           (ev.get("title") or "").strip(),
            "description":     desc,
            "category":        "club",
            "start_at":        start_at,
            "end_at":          end_at,
            "venue": {
                "name":            venue.get("name", ""),
                "address":         venue.get("address"),
                "lat":             location.get("latitude"),
                "lng":             location.get("longitude"),
                "google_place_id": None,
            },
            "price":      {"min": p_min, "max": p_max, "currency": currency},
            "is_free":    is_free,
            "ticket_url": event_url,
            "images":     images,
            "tags":       genres[:5] + ["nightlife"],
        }

    def fetch(self) -> List[dict]:
        today   = datetime.now(BUCHAREST_TZ)
        date_to = today + timedelta(days=self.days_ahead)
        events  = []
        page    = 1

        filters = {
            "areas":       {"eq": RA_AREA_ID},
            "listingDate": {
                "gte": today.strftime("%Y-%m-%dT00:00:00"),
                "lte": date_to.strftime("%Y-%m-%dT23:59:59"),
            },
        }
        while True:
            try:
                resp = requests.post(
                    RA_GRAPHQL,
                    json={
                        "query": RA_QUERY,
                        "variables": {
                            "filters":  filters,
                            "pageSize": 100,
                            "page":     page,
                        },
                    },
                    headers=HEADERS,
                    timeout=30,
                )
                resp.raise_for_status()
                body = resp.json()

                if body.get("errors"):
                    log.warning(f"RA page {page} errors: {body['errors']}")
                    break

                ld    = (body.get("data") or {}).get("eventListings") or {}
                items = ld.get("data") or []
                total = ld.get("totalResults") or 0

                for item in items:
                    parsed = self._parse_item(item)
                    if parsed and parsed["title"]:
                        events.append(parsed)

                log.info(f"  RA page {page}: {len(items)}/{total}")
                if page * 100 >= total or not items:
                    break
                page += 1
                time.sleep(0.5)

            except Exception as e:
                log.error(f"RA page {page}: {e}")
                break

        return events


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    import json, sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    evs = RaScraper(days_ahead=14).run()
    print(f"\nTotal: {len(evs)}")
    if evs:
        print(json.dumps(evs[0], indent=2, ensure_ascii=False))
