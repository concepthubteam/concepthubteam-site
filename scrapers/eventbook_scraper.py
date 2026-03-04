"""
GOZI Scraper — Eventbook.ro Bucharest  (highest priority source = 100)
Covers a broad range of cultural + entertainment events.
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
BASE_URL = "https://www.eventbook.ro"
LIST_URL = f"{BASE_URL}/evenimente/bucuresti/"
HEADERS  = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "ro-RO,ro;q=0.9",
}


class EventbookScraper(BaseScraper):
    source = "eventbook"

    def __init__(self, max_pages: int = 20):
        self.max_pages = max_pages

    def _fetch_detail(self, url: str) -> dict:
        """Enrich with venue, lat/lng, description from event page."""
        try:
            r = requests.get(url, headers=HEADERS, timeout=12)
            if r.status_code != 200:
                return {}
            soup = BeautifulSoup(r.text, "lxml")

            # Venue name
            venue_el = (
                soup.select_one(".venue-name, .location h3, .event-venue, [itemprop='location'] [itemprop='name']")
                or soup.select_one("[class*='venue'], [class*='location']")
            )
            venue = venue_el.get_text(strip=True)[:120] if venue_el else None

            # Address
            addr_el = soup.select_one("[itemprop='address'], .event-address, [class*='address']")
            address = addr_el.get_text(strip=True)[:200] if addr_el else None

            # Description
            desc_el = (
                soup.select_one("[itemprop='description'], .event-description, .description, [class*='description']")
            )
            desc = desc_el.get_text(" ", strip=True)[:800] if desc_el else None

            # lat/lng from schema.org or Google Maps embed
            lat = lng = None
            script_tags = soup.find_all("script", string=re.compile(r'"latitude"|"@type".*"Event"'))
            for script in script_tags:
                text = script.string or ""
                lat_m = re.search(r'"latitude"\s*:\s*([\-\d.]+)', text)
                lng_m = re.search(r'"longitude"\s*:\s*([\-\d.]+)', text)
                if lat_m:
                    lat = float(lat_m.group(1))
                if lng_m:
                    lng = float(lng_m.group(1))

            # Maps embed fallback
            if not lat:
                maps_el = soup.find("iframe", src=re.compile(r"maps\.google|google.*maps"))
                if maps_el:
                    m = re.search(r"q=([\-\d.]+),([\-\d.]+)", maps_el.get("src", ""))
                    if m:
                        lat, lng = float(m.group(1)), float(m.group(2))

            return {"venue": venue, "address": address, "desc": desc, "lat": lat, "lng": lng}
        except Exception as e:
            log.debug(f"detail fetch error ({url}): {e}")
            return {}

    def _parse_card(self, card) -> Optional[dict]:
        title_el = card.select_one("h2, h3, h4, .event-title, [class*='title']")
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

        date_el  = card.select_one("time, .date, .event-date, [itemprop='startDate'], [class*='date']")
        date_str = ""
        if date_el:
            date_str = date_el.get("datetime") or date_el.get("content") or date_el.get_text(strip=True)
        start_at = parse_ro_date(date_str)
        if not start_at:
            return None

        venue_el   = card.select_one(".venue, .location, [class*='venue']")
        venue_name = venue_el.get_text(strip=True)[:120] if venue_el else ""

        price_el  = card.select_one(".price, [class*='price'], [class*='pret']")
        price_str = price_el.get_text(strip=True) if price_el else ""
        p_min, p_max, currency, is_free = parse_price(price_str)

        img_el = card.select_one("img")
        images = []
        if img_el:
            src = img_el.get("data-src") or img_el.get("src") or ""
            if src and "placeholder" not in src:
                images.append(src if src.startswith("http") else BASE_URL + src)

        tag_els  = card.select(".tag, .category, [class*='tag'], [class*='genre']")
        tags     = [t.get_text(strip=True).lower() for t in tag_els]
        category = map_category(" ".join([title] + tags))

        return {
            "source":          "eventbook",
            "source_event_id": f"eb_{abs(hash(event_url or title))}",
            "url":             event_url,
            "title":           title[:200],
            "description":     None,
            "category":        category,
            "start_at":        start_at,
            "end_at":          None,
            "venue": {
                "name":            venue_name or "Verifică pe Eventbook",
                "address":         f"{venue_name}, București" if venue_name else "București",
                "lat":             None,
                "lng":             None,
                "google_place_id": None,
            },
            "price":      {"min": p_min, "max": p_max, "currency": currency},
            "is_free":    is_free,
            "ticket_url": event_url,
            "images":     images,
            "tags":       tags[:8],
            "_detail_url": event_url,   # enriched below
        }

    def _scrape_page(self, url: str) -> List[dict]:
        events = []
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            r.raise_for_status()
            soup  = BeautifulSoup(r.text, "lxml")
            cards = (
                soup.select("article.event, article.event-item, .event-card, .listing-item")
                or soup.select("article, .event")
            )
            for card in cards:
                try:
                    parsed = self._parse_card(card)
                    if parsed:
                        # Enrich from detail page
                        detail_url = parsed.pop("_detail_url", "")
                        if detail_url:
                            detail = self._fetch_detail(detail_url)
                            if detail.get("venue"):
                                parsed["venue"]["name"]    = detail["venue"]
                                parsed["venue"]["address"] = detail.get("address") or parsed["venue"]["address"]
                            if detail.get("lat"):
                                parsed["venue"]["lat"] = detail["lat"]
                                parsed["venue"]["lng"] = detail["lng"]
                            if detail.get("desc"):
                                parsed["description"] = detail["desc"]
                            time.sleep(0.3)
                        events.append(parsed)
                except Exception as e:
                    log.debug(f"card error: {e}")
        except Exception as e:
            log.error(f"Eventbook page {url}: {e}")
        return events

    def fetch(self) -> List[dict]:
        events = []
        for page in range(1, self.max_pages + 1):
            url   = LIST_URL if page == 1 else f"{LIST_URL}?page={page}"
            batch = self._scrape_page(url)
            if not batch:
                break
            events.extend(batch)
            log.info(f"  Eventbook page {page}: +{len(batch)} (total {len(events)})")
            time.sleep(1.0)
        return events


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    import json, sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    evs = EventbookScraper().run()
    print(f"\nTotal: {len(evs)}")
    if evs:
        print(json.dumps(evs[0], indent=2, ensure_ascii=False))
