"""
GOZI Scraper — iaBilet.ro Bucharest
Outputs canonical event format. Run standalone or via run_daily.py.

CSS selectors verified against live HTML 2026-03-04:
  card:     div.event-list-item
  title:    .title a span  (or .title)
  url:      a[href] (first link)
  date:     .date .date-start → .date-day / .date-month / .date-year
  venue:    a.venue span  (in .location)
  price:    .price
  image:    .event-image img
"""

import logging
import re
import time
from datetime import datetime
from typing import List, Optional

import pytz
import requests
from bs4 import BeautifulSoup

from scrapers.base import BaseScraper
from pipeline.normalize import parse_price, map_category

log      = logging.getLogger(__name__)
BASE_URL = "https://www.iabilet.ro"
LIST_URL = f"{BASE_URL}/bilete-bucuresti/"
BUCHAREST_TZ = pytz.timezone("Europe/Bucharest")
HEADERS  = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "ro-RO,ro;q=0.9",
}

# Abbreviated Romanian month names → month number
RO_MONTHS = {
    "ian": 1, "feb": 2, "mar": 3, "apr": 4, "mai": 5, "iun": 6,
    "iul": 7, "aug": 8, "sep": 9, "oct": 10, "noi": 11, "nov": 11, "dec": 12,
}


def _parse_iabilet_date(date_start_el) -> Optional[str]:
    """Parse iaBilet's .date-start element with .date-day / .date-month / .date-year spans."""
    if not date_start_el:
        return None
    day_el   = date_start_el.select_one(".date-day")
    month_el = date_start_el.select_one(".date-month")
    year_el  = date_start_el.select_one(".date-year")
    if not day_el or not month_el:
        return None
    try:
        day   = int(day_el.get_text(strip=True))
        month_raw = month_el.get_text(strip=True).lower()
        month = RO_MONTHS.get(month_raw)
        if not month:
            return None
        year_raw = year_el.get_text(strip=True) if year_el else ""
        year_raw = year_raw.lstrip("'")
        if len(year_raw) == 2:
            year = 2000 + int(year_raw)
        elif len(year_raw) == 4:
            year = int(year_raw)
        else:
            year = datetime.now().year
        dt = datetime(year, month, day, 20, 0)  # default 20:00
        return BUCHAREST_TZ.localize(dt).isoformat()
    except (ValueError, TypeError):
        return None


class IabiletScraper(BaseScraper):
    source = "iabilet"

    def __init__(self, max_pages: int = 15, fetch_detail: bool = False):
        self.max_pages    = max_pages
        self.fetch_detail = fetch_detail  # set True to enrich venue/desc (slower)

    def _fetch_detail(self, url: str) -> dict:
        """Grab venue + description from event detail page."""
        try:
            r = requests.get(url, headers=HEADERS, timeout=10)
            if r.status_code != 200:
                return {}
            soup = BeautifulSoup(r.text, "lxml")
            venue_el = soup.select_one(".venue-name, .location-name")
            desc_el  = soup.select_one(".event-description, .description, [class*='description']")
            return {
                "venue": venue_el.get_text(strip=True)[:120] if venue_el else None,
                "desc":  desc_el.get_text(" ", strip=True)[:600] if desc_el else None,
            }
        except Exception:
            return {}

    def _parse_card(self, card) -> Optional[dict]:
        # ── Title ─────────────────────────────────────────────────────────────
        title_el = (
            card.select_one(".title a span")
            or card.select_one(".title a")
            or card.select_one(".title")
        )
        if not title_el:
            return None
        title = title_el.get_text(strip=True)
        if not title or len(title) < 3:
            return None

        # ── URL ───────────────────────────────────────────────────────────────
        link = card.select_one("a[href]")
        event_url = ""
        if link:
            href      = link["href"]
            event_url = href if href.startswith("http") else BASE_URL + href

        # ── Date ──────────────────────────────────────────────────────────────
        date_start_el = card.select_one(".date .date-start") or card.select_one(".date-start")
        start_at = _parse_iabilet_date(date_start_el)
        if not start_at:
            return None  # skip undated events

        # ── Venue (from card) ─────────────────────────────────────────────────
        venue_el   = card.select_one(".location a.venue span") or card.select_one("a.venue")
        venue_name = venue_el.get_text(strip=True)[:120] if venue_el else "iaBilet București"

        # ── Price ─────────────────────────────────────────────────────────────
        price_el  = card.select_one(".price")
        price_str = price_el.get_text(strip=True) if price_el else ""
        p_min, p_max, currency, is_free = parse_price(price_str)

        # ── Image ─────────────────────────────────────────────────────────────
        img_el = card.select_one(".event-image img") or card.select_one("img")
        images = []
        if img_el:
            src = img_el.get("data-src") or img_el.get("src") or ""
            if src and not src.endswith(".gif") and "placeholder" not in src:
                images.append(src if src.startswith("http") else BASE_URL + src)

        # ── Category ──────────────────────────────────────────────────────────
        category = map_category(title)

        # ── Optional detail page ──────────────────────────────────────────────
        detail = {}
        if self.fetch_detail and event_url:
            detail = self._fetch_detail(event_url)
            time.sleep(0.3)
        if detail.get("venue"):
            venue_name = detail["venue"]

        return {
            "source":          "iabilet",
            "source_event_id": f"iabilet_{abs(hash(event_url or title))}",
            "url":             event_url,
            "title":           title[:200],
            "description":     detail.get("desc"),
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
            "tags":       ["iabilet", "bucurești", category],
        }

    def _scrape_page(self, url: str) -> List[dict]:
        events = []
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            r.raise_for_status()
            soup  = BeautifulSoup(r.text, "lxml")
            # Verified selector: div.event-list-item
            cards = soup.select("div.event-list-item")
            log.debug(f"  iaBilet {url}: {len(cards)} cards found")
            for card in cards:
                try:
                    parsed = self._parse_card(card)
                    if parsed:
                        events.append(parsed)
                except Exception as e:
                    log.debug(f"card error: {e}")
        except Exception as e:
            log.error(f"iaBilet page {url}: {e}")
        return events

    def fetch(self) -> List[dict]:
        events = []
        for page in range(1, self.max_pages + 1):
            url   = LIST_URL if page == 1 else f"{LIST_URL}?page={page}"
            batch = self._scrape_page(url)
            if not batch:
                break
            events.extend(batch)
            log.info(f"  iaBilet page {page}: +{len(batch)} (total {len(events)})")
            time.sleep(1.0)
        return events


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    import json, sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    evs = IabiletScraper(max_pages=1).run()
    print(f"\nTotal: {len(evs)}")
    if evs:
        print(json.dumps(evs[0], indent=2, ensure_ascii=False))
