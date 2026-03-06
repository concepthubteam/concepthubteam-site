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
# NOTE: site migrated from www.zilesinopti.ro/bucuresti/{slug}/ to
# zilesinopti.ro/{slug}/ with kzn-* plugin class names (2026).
BASE_URL = "https://zilesinopti.ro"

# (url_slug → gozi_category)
SECTIONS = [
    ("evenimente",  "events"),
    ("concerte",    "music"),
    ("teatru",      "theatre"),
    ("clubbing",    "club"),
    ("expozitii",   "expo"),
    ("kids",        "kids"),
]

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "ro-RO,ro;q=0.9",
}


class ZilesiNoptiScraper(BaseScraper):
    source = "zilesinopti"

    def __init__(self, max_pages_per_section: int = 3):
        self.max_pages = max_pages_per_section

    def _parse_card(self, card, default_category: str,
                    page_date: Optional[str] = None) -> Optional[dict]:
        """
        Parse a kzn-sw-item-text card (post-2026 plugin structure).
        page_date: ISO date string for the listing page (YYYY-MM-DD).
        """
        # ── Title (h3.kzn-sw-item-titlu > a) ────────────────────────────────
        title_el = (
            card.select_one("[class*='kzn-sw-item-titlu'] a")
            or card.select_one("h2 a, h3 a, h4 a")
            or card.select_one("h2, h3, h4")
        )
        if not title_el:
            return None
        title = title_el.get_text(strip=True)
        if not title or len(title) < 3:
            return None

        # ── URL ──────────────────────────────────────────────────────────────
        link      = card.select_one("a[href]")
        event_url = ""
        if link:
            href      = link.get("href", "")
            event_url = href if href.startswith("http") else BASE_URL + href

        # ── Date: kzn-sw-item-textjos contains "4/03/26" (D/MM/YY) ─────────
        date_str = ""
        date_el  = card.select_one("[class*='kzn-sw-item-textjos']")
        if date_el:
            date_str = date_el.get_text(strip=True)
        # Fallback: infer from event URL slug (contains /YYYY/MM/DD/)
        if not date_str and event_url:
            m = re.search(r'/(\d{4}/\d{2}/\d{2})/', event_url)
            if m:
                date_str = m.group(1).replace("/", "-")
        # Final fallback: use page_date
        if not date_str and page_date:
            date_str = page_date
        start_at = parse_ro_date(date_str) if date_str else None
        if not start_at:
            return None

        # ── Venue ────────────────────────────────────────────────────────────
        venue_el = (
            card.select_one("[class*='kzn-sw-item-adresa-eveniment'] a")
            or card.select_one("[class*='kzn-sw-item-adresa'] a")
            or card.select_one("[class*='kzn-sw-item-adresa']")
        )
        venue_name = venue_el.get_text(strip=True)[:120] if venue_el else "București"

        # ── Category from kzn-sw-item-textsus ────────────────────────────────
        cat_el = card.select_one("[class*='kzn-sw-item-textsus']")
        category = default_category
        if cat_el:
            raw = cat_el.get_text(strip=True).lower()
            if "concert" in raw or "muzic" in raw:
                category = "music"
            elif "teatru" in raw or "spectacol" in raw:
                category = "theatre"
            elif "club" in raw:
                category = "club"
            elif "expozi" in raw:
                category = "expo"
            elif "copii" in raw or "kids" in raw:
                category = "kids"

        # ── Price ─────────────────────────────────────────────────────────────
        price_el  = card.select_one(".price, .pret, [class*='price'], [class*='pret']")
        price_str = price_el.get_text(strip=True) if price_el else ""
        p_min, p_max, currency, is_free = parse_price(price_str)

        # ── Image ─────────────────────────────────────────────────────────────
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
            "tags":       [category, "zilesinopti", "bucurești"],
        }

    def _scrape_section(self, slug: str, category: str) -> List[dict]:
        """
        Scrape a section by fetching today + the next (max_pages-1) days.
        ZilesiNopti uses ?zi=YYYY-MM-DD for per-day pagination.
        """
        from datetime import date, timedelta

        events  = []
        today   = date.today()

        for day_offset in range(self.max_pages):
            target_date = today + timedelta(days=day_offset)
            date_str    = target_date.strftime("%Y-%m-%d")

            url = (
                f"{BASE_URL}/{slug}/"
                if day_offset == 0
                else f"{BASE_URL}/{slug}/?zi={date_str}"
            )
            try:
                r = requests.get(url, headers=HEADERS, timeout=20)
                r.raise_for_status()
                soup  = BeautifulSoup(r.text, "lxml")
                # kzn plugin cards (post-2026)
                cards = soup.select("div.kzn-sw-item-text")
                if not cards:
                    # Legacy fallback selectors
                    cards = (
                        soup.select("article.event, article.listing-item, li.event-item")
                        or soup.select(".item-event, .card-event, .event-card")
                    )
                if not cards:
                    break

                batch_count = 0
                for card in cards:
                    try:
                        parsed = self._parse_card(card, category,
                                                  page_date=date_str)
                        if parsed:
                            events.append(parsed)
                            batch_count += 1
                    except Exception as e:
                        log.debug(f"card error: {e}")

                log.debug(f"  ZSN /{slug}/ zi={date_str}: {batch_count} events")
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
