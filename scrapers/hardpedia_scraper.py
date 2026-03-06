"""
GOZI — Hardpedia.ro scraper (DISABLED — site dispărut)

hardpedia.ro → NXDOMAIN din 2026-03.
hardpedia.com → CloudFront 404.

Scena techno/electronic București este acoperită de:
  - ra_scraper.py       (Resident Advisor — 40-60 events/run)
  - iabilet_scraper.py  (include events club/electronic)

TODO: găsiți un înlocuitor. Candidați:
  - billetto.ro (listing-uri events România)
  - eventya.ro  (dacă revine online)
"""

import logging
import os
import re
import time
import requests
from bs4 import BeautifulSoup
from datetime import datetime
from typing import Optional
from dotenv import load_dotenv

log = logging.getLogger(__name__)

load_dotenv()

SUPABASE_URL = (
    os.getenv("EXPO_PUBLIC_SUPABASE_URL") or
    os.getenv("SUPABASE_URL") or
    ""
)
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

BASE_URL   = "https://hardpedia.ro"   # NXDOMAIN — nu mai funcționează
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


def scrape_hardpedia() -> list[dict]:
    """Încearcă să scrape hardpedia.ro — returnează [] deoarece site-ul nu mai există."""
    log.warning(
        "⚠️  hardpedia.ro este NXDOMAIN din 2026-03. "
        "Scraper dezactivat. Scena techno/electronic e acoperită de ra_scraper.py."
    )
    return []


def push_to_supabase(rows: list[dict], supabase) -> int:
    if not rows:
        return 0
    result = supabase.table("events").insert(rows).execute()
    return len(result.data) if result.data else 0


class HardpediaScraper:
    """
    Class-based wrapper — compatibil cu run_daily.py pipeline.
    DISABLED: hardpedia.ro NXDOMAIN din 2026-03.
    """
    source = "hardpedia"

    def __init__(self, max_pages: int = 3):
        self.max_pages = max_pages

    def run(self) -> list:
        return scrape_hardpedia()

    @staticmethod
    def _to_canonical(e: dict) -> dict:
        return {
            "title":        e.get("title", ""),
            "start_at":     e.get("date_iso"),
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
    log.warning("hardpedia.ro este NXDOMAIN — scraper dezactivat.")
    print("⚠️  hardpedia.ro dispărut (NXDOMAIN). Nimic de inserat.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
