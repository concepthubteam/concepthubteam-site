"""
GOZI Scraper — IESIM.ro Bucharest
Younger-skewing events, parties, nightlife, experiences.
"""

import logging
import re
import time
from typing import List, Optional

import requests
from bs4 import BeautifulSoup

from scrapers.base import BaseScraper
from pipeline.normalize import parse_price, parse_ro_date, map_category

log      = logging.getLogger(__name__)
BASE_URL = "https://iesim.ro"
LIST_URL = f"{BASE_URL}/evenimente/bucuresti"
HEADERS  = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "ro-RO,ro;q=0.9",
}


class IesimScraper(BaseScraper):
    source = "iesim"

    def __init__(self, max_pages: int = 10):
        self.max_pages = max_pages

    def _parse_card(self, card) -> Optional[dict]:
        title_el = card.select_one("h2, h3, h4, .title, .event-name, [class*='title']")
        if not title_el:
            return None
        title = title_el.get_text(strip=True)
        if not title or len(title) < 3:
            return None

        link      = card.select_one("a[href]")
        event_url = ""
        if link:
            href      = link["href"]
            event_url = href if href.startswith("http") else BASE_URL + href

        date_el  = card.select_one("time, .date, [class*='date'], [class*='when']")
        date_str = ""
        if date_el:
            date_str = date_el.get("datetime") or date_el.get_text(strip=True)
        start_at = parse_ro_date(date_str)
        if not start_at:
            return None

        venue_el   = card.select_one(".venue, .location, .place, [class*='venue'], [class*='location']")
        venue_name = venue_el.get_text(strip=True)[:120] if venue_el else "Verifică pe IESIM"

        price_el  = card.select_one(".price, .cost, [class*='price'], [class*='cost']")
        price_str = price_el.get_text(strip=True) if price_el else ""
        p_min, p_max, currency, is_free = parse_price(price_str)

        img_el = card.select_one("img")
        images = []
        if img_el:
            src = img_el.get("data-src") or img_el.get("src") or ""
            if src and "placeholder" not in src:
                images.append(src if src.startswith("http") else BASE_URL + src)

        tag_els  = card.select(".tag, .category, [class*='tag']")
        tags     = [t.get_text(strip=True).lower() for t in tag_els]
        category = map_category(" ".join([title] + tags))

        return {
            "source":          "iesim",
            "source_event_id": f"iesim_{abs(hash(event_url or title))}",
            "url":             event_url,
            "title":           title[:200],
            "description":     None,
            "category":        category,
            "start_at":        start_at,
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
            "tags":       tags[:8],
        }

    def _scrape_page(self, url: str) -> List[dict]:
        events = []
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            r.raise_for_status()
            soup  = BeautifulSoup(r.text, "lxml")
            cards = (
                soup.select("article.event, .event-card, .event-item, .listing-item")
                or soup.select("article, [class*='event']")
            )
            for card in cards:
                try:
                    parsed = self._parse_card(card)
                    if parsed:
                        events.append(parsed)
                except Exception as e:
                    log.debug(f"card error: {e}")
        except Exception as e:
            log.error(f"IESIM page {url}: {e}")
        return events

    def fetch(self) -> List[dict]:
        events = []
        for page in range(1, self.max_pages + 1):
            url   = LIST_URL if page == 1 else f"{LIST_URL}?page={page}"
            batch = self._scrape_page(url)
            if not batch:
                break
            events.extend(batch)
            log.info(f"  IESIM page {page}: +{len(batch)} (total {len(events)})")
            time.sleep(1.0)
        return events


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    import json, sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    evs = IesimScraper().run()
    print(f"\nTotal: {len(evs)}")
    if evs:
        print(json.dumps(evs[0], indent=2, ensure_ascii=False))
