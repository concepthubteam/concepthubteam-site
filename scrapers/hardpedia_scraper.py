"""
GOZI — Hardpedia.ro scraper pentru cluburi București
Extrage events din hardpedia.ro (techno/electronic scene Romania).

Rulare:
    cd scrapers
    pip install -r requirements.txt
    python hardpedia_scraper.py

Hardpedia nu are API — scraping HTML cu BeautifulSoup.
"""

import os
import re
import time
import requests
from bs4 import BeautifulSoup
from datetime import datetime
from typing import Optional
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = (
    os.getenv("EXPO_PUBLIC_SUPABASE_URL") or
    os.getenv("SUPABASE_URL") or
    ""
)
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

BASE_URL = "https://hardpedia.ro"
EVENTS_URL = f"{BASE_URL}/evenimente"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "ro-RO,ro;q=0.9",
}

LUNI_RO = {
    "ianuarie": 1, "februarie": 2, "martie": 3, "aprilie": 4,
    "mai": 5, "iunie": 6, "iulie": 7, "august": 8,
    "septembrie": 9, "octombrie": 10, "noiembrie": 11, "decembrie": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def parse_ro_date(date_str: str) -> Optional[str]:
    """Parse date like '15 Martie 2026' → '2026-03-15'."""
    if not date_str:
        return None
    date_str = date_str.strip().lower()
    parts = date_str.split()
    if len(parts) >= 2:
        try:
            day   = int(parts[0])
            month = LUNI_RO.get(parts[1], 0)
            year  = int(parts[2]) if len(parts) > 2 else datetime.now().year
            if month:
                return f"{year:04d}-{month:02d}-{day:02d}"
        except (ValueError, IndexError):
            pass
    return None


def scrape_event_detail(url: str) -> dict:
    """Scrape detalii eveniment de pe pagina individuală."""
    details = {"website": url, "description": None, "image": None, "time": None}
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(resp.text, "html.parser")

        # Descriere
        desc_el = soup.select_one(".event-description, .content-area p, article p")
        if desc_el:
            details["description"] = desc_el.get_text(strip=True)[:500]

        # Imagine
        img_el = soup.select_one("article img, .event-image img, .featured-image img")
        if img_el and img_el.get("src"):
            src = img_el["src"]
            details["image"] = src if src.startswith("http") else BASE_URL + src

        # Ora
        time_el = soup.find(string=re.compile(r"\d{2}:\d{2}"))
        if time_el:
            match = re.search(r"(\d{2}:\d{2})", time_el)
            if match:
                details["time"] = match.group(1)

    except Exception as e:
        print(f"   ⚠️  Eroare detalii {url}: {e}")
    return details


def scrape_hardpedia() -> list[dict]:
    """Scrape lista de events de pe hardpedia.ro."""
    print(f"🔍  Scraping {EVENTS_URL}...")
    events = []

    try:
        resp = requests.get(EVENTS_URL, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"❌  Nu pot accesa hardpedia.ro: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")

    # Selectori comuni pentru pagini de events
    event_cards = soup.select(".event-item, .event-card, article.post, .events-list > li")

    if not event_cards:
        print("⚠️  Nu s-au găsit carduri events. Structura site-ului s-a schimbat?")
        print("   Încercați să verificați manual:", EVENTS_URL)
        return []

    print(f"   {len(event_cards)} events găsite...")

    for card in event_cards[:20]:  # max 20 events per rulare
        title_el = card.select_one("h2, h3, .event-title, .title")
        link_el  = card.select_one("a[href]")
        date_el  = card.select_one(".event-date, .date, time")
        venue_el = card.select_one(".event-venue, .venue, .location")

        title = title_el.get_text(strip=True) if title_el else None
        if not title:
            continue

        link = link_el["href"] if link_el else None
        if link and not link.startswith("http"):
            link = BASE_URL + link

        raw_date = date_el.get_text(strip=True) if date_el else ""
        date_iso = parse_ro_date(raw_date)

        venue = venue_el.get_text(strip=True) if venue_el else "București"

        # Fetch detalii individual (cu pauză)
        details = {}
        if link:
            details = scrape_event_detail(link)
            time.sleep(0.5)

        # Format dată afișat
        date_display = ""
        if date_iso:
            try:
                d = datetime.fromisoformat(date_iso)
                zile = ["Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă", "Duminică"]
                luni = ["Ian", "Feb", "Mar", "Apr", "Mai", "Iun",
                        "Iul", "Aug", "Sep", "Oct", "Nov", "Dec"]
                date_display = f"{zile[d.weekday()]}, {d.day} {luni[d.month - 1]}"
            except ValueError:
                date_display = raw_date

        event = {
            "title":          title[:200],
            "category":       "clubs",
            "category_label": "Cluburi",
            "date":           date_display,
            "date_iso":       date_iso,
            "time":           details.get("time"),
            "venue":          venue[:200],
            "address":        "București",
            "price":          "Gratuit",  # default — actualizați manual
            "rating":         4.1,
            "description":    details.get("description"),
            "lat":            44.4268,   # București centru — actualizați cu venue real
            "lng":            26.1025,
            "featured":       False,
            "tags":           ["techno", "electronic", "club", "bucurești"],
            "website":        details.get("website") or link,
            "image":          details.get("image"),
        }
        events.append(event)
        print(f"   ✓ {title[:50]}")

    return events


def push_to_supabase(rows: list[dict], supabase) -> int:
    if not rows:
        return 0
    result = supabase.table("events").insert(rows).execute()
    return len(result.data) if result.data else 0


class HardpediaScraper:
    """
    Class-based wrapper for hardpedia_scraper — compatible with run_daily.py pipeline.
    Usage:
        scraper = HardpediaScraper(max_pages=3)
        events  = scraper.run()   # returns list[dict] in canonical format
    """
    source = "hardpedia"

    def __init__(self, max_pages: int = 3):
        self.max_pages = max_pages

    def run(self) -> list:
        """Scrape and return events in canonical pipeline format."""
        raw = scrape_hardpedia()
        return [self._to_canonical(e) for e in raw]

    @staticmethod
    def _to_canonical(e: dict) -> dict:
        """Map hardpedia dict → canonical event dict expected by pipeline/ingest.py."""
        return {
            "title":        e.get("title", ""),
            "start_at":     e.get("date_iso"),        # ISO date string or None
            "time_display": e.get("time"),
            "venue_name":   e.get("venue", "București"),
            "venue_city":   "București",
            "address":      e.get("address", "București"),
            "category":     "club",
            "price_min":    None,
            "price_max":    None,
            "price_display":e.get("price", "Gratuit"),
            "description":  e.get("description"),
            "image_url":    e.get("image"),
            "source_url":   e.get("website"),
            "source":       "hardpedia",
            "lat":          e.get("lat"),
            "lng":          e.get("lng"),
            "tags":         e.get("tags", []),
        }


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌  Lipsesc SUPABASE_URL (sau EXPO_PUBLIC_SUPABASE_URL) și "
              "SUPABASE_SERVICE_ROLE_KEY în .env")
        return

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    events = scrape_hardpedia()

    if not events:
        print("⚠️  Nu s-au găsit events.")
        return

    print(f"\n📦  {len(events)} events. Push în Supabase...")
    inserted = push_to_supabase(events, sb)
    print(f"✅  {inserted} events inserați!")


if __name__ == "__main__":
    main()
