"""
GOZI Scraper — ZilesiNopti.ro Bucharest
Covers: evenimente, concerte, teatru, clubbing, restaurante.
Outputs canonical event format.
"""

import logging
import re
import time
from typing import List, Optional

import requests
from bs4 import BeautifulSoup

from scrapers.base import BaseScraper
from pipeline.normalize import parse_price, parse_ro_date

log      = logging.getLogger(__name__)
BASE_URL = "https://www.zilesinopti.ro"

# (url_slug → gozi_category)
SECTIONS = [
    ("evenimente",   "events"),
    ("concerte",     "music"),
    ("teatru",       "theatre"),
    ("clubbing",     "club"),
    ("restaurante",  "food"),
    ("expozitii",    "expo"),
    ("kids",         "kids"),
]

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "ro-RO,ro;q=0.9",
}


class ZilesiNoptiScraper(BaseScraper):
    source = "zilesinopti"

    def __init__(self, max_pages_per_section: int = 3):
        self.max_pages = max_pages_per_section

    def _parse_card(self, card, default_category: str) -> Optional[dict]:
        # Title
        title_el = (
            card.select_one("h2, h3, h4")
            or card.select_one(".title, .event-title, [class*='title']")
            or card.select_one("a")
        )
        if not title_el:
            return None
        title = title_el.get_text(strip=True)
        if not title or len(title) < 3:
            return None

        # URL
        link      = card.select_one("a[href]")
        event_url = ""
        if link:
            href      = link["href"]
            event_url = href if href.startswith("http") else BASE_URL + href

        # Date
        date_el  = card.select_one("time, .date, .data, [class*='date'], [class*='when']")
        date_str = ""
        if date_el:
            date_str = date_el.get("datetime") or date_el.get_text(strip=True)
        start_at = parse_ro_date(date_str)
        # ZilesiNopti restaurants/always-open venues have no date → keep None
        if not start_at and default_category not in ("food",):
            return None

        # Venue
        venue_el   = card.select_one(".venue, .location, .loc, [class*='venue'], [class*='location']")
        venue_name = venue_el.get_text(strip=True)[:120] if venue_el else "București"

        # Price
        price_el  = card.select_one(".price, .pret, [class*='price'], [class*='pret']")
        price_str = price_el.get_text(strip=True) if price_el else ""
        p_min, p_max, currency, is_free = parse_price(price_str)

        # Rating
        rating_el = card.select_one("[class*='rating'], [class*='star'], [class*='score']")
        rating = 4.0
        if rating_el:
            nums = re.findall(r"[\d.]+", rating_el.get_text())
            if nums:
                rating = min(5.0, float(nums[0]))

        # Image
        img_el = card.select_one("img")
        images = []
        if img_el:
            src = img_el.get("data-src") or img_el.get("data-lazy-src") or img_el.get("src") or ""
            if src and "placeholder" not in src and not src.endswith(".gif"):
                images.append(src if src.startswith("http") else BASE_URL + src)

        return {
            "source":          "zilesinopti",
            "source_event_id": f"zsn_{abs(hash(event_url or title))}",
            "url":             event_url,
            "title":           title[:200],
            "description":     None,
            "category":        default_category,
            "start_at":        start_at or "2099-01-01T00:00:00+02:00",  # always-open sentinel
            "end_at":          None,
            "venue": {
                "name":            venue_name,
                "address":         f"{venue_name}, București",
                "lat":             None,
                "lng":             None,
                "google_place_id": None,
            },
            "price":      {"min": p_min, "max": p_max, "currency": currency},
            "is_free":    is_free,
            "ticket_url": event_url,
            "images":     images,
            "tags":       [default_category, "zilesinopti", "bucurești"],
        }

    def _scrape_section(self, slug: str, category: str) -> List[dict]:
        events = []
        for page in range(1, self.max_pages + 1):
            url = (
                f"{BASE_URL}/bucuresti/{slug}/"
                if page == 1
                else f"{BASE_URL}/bucuresti/{slug}/?page={page}"
            )
            try:
                r = requests.get(url, headers=HEADERS, timeout=20)
                r.raise_for_status()
                soup  = BeautifulSoup(r.text, "lxml")
                cards = (
                    soup.select("article.event, article.listing-item, li.event-item")
                    or soup.select(".item-event, .card-event, .event-card")
                )
                if not cards:
                    break
                for card in cards:
                    try:
                        parsed = self._parse_card(card, category)
                        if parsed:
                            events.append(parsed)
                    except Exception as e:
                        log.debug(f"card error: {e}")

                log.debug(f"  ZSN /{slug}/ page {page}: {len(cards)} cards")
                time.sleep(0.8)

            except Exception as e:
                log.error(f"ZSN {url}: {e}")
                break

        return events

    def fetch(self) -> List[dict]:
        all_events = []
        seen_urls  = set()

        for slug, category in SECTIONS:
            batch = self._scrape_section(slug, category)
            # dedupe by URL within this scraper
            for ev in batch:
                key = ev["url"] or ev["title"]
                if key not in seen_urls:
                    seen_urls.add(key)
                    all_events.append(ev)
            log.info(f"  ZSN /{slug}/: {len(batch)} events")
            time.sleep(1.0)

        return all_events


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    import json, sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    evs = ZilesiNoptiScraper().run()
    print(f"\nTotal: {len(evs)}")
    if evs:
        print(json.dumps(evs[0], indent=2, ensure_ascii=False))
