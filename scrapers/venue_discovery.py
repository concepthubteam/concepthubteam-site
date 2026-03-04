"""
GOZI — Venue Discovery Engine: Module 1
Discovers official venue websites via web search.

Providers (tried in order):
  1. Google Custom Search JSON API  (GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID)
  2. SerpAPI                        (SERPAPI_KEY)
  3. DuckDuckGo HTML fallback       (free, no key needed)

Usage:
  disc = VenueDiscovery()
  url  = disc.discover("Control Club")   # → "https://www.control-club.ro"
  urls = disc.discover_batch(["Control Club", "Quantic", "Expirat"])
"""

import logging
import re
import time
from typing import Optional
from urllib.parse import parse_qs, urlparse

import requests
from rapidfuzz import fuzz

log = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Domains that are NEVER an official venue website
# ─────────────────────────────────────────────────────────────────────────────
EXCLUDED_DOMAINS = {
    # Social / video
    "facebook.com", "fb.com", "instagram.com", "twitter.com", "x.com",
    "tiktok.com", "youtube.com", "youtu.be", "vimeo.com",
    # Ticketing platforms (local + global)
    "eventbook.ro", "iabilet.ro", "bilete.ro", "tickets.ro", "ticketmaster.ro",
    "ra.co", "residentadvisor.net", "zilesinopti.ro", "iesim.ro",
    "eventbrite.com", "eventbrite.co.uk", "festicket.com", "gigantic.com",
    # Review / discovery
    "tripadvisor.com", "tripadvisor.ro", "foursquare.com", "yelp.com",
    "timeout.com", "yelp.ro",
    # Search / maps
    "google.com", "google.ro", "bing.com", "yahoo.com",
    "maps.google.com", "openstreetmap.org", "waze.com",
    # Wikipedia / knowledge
    "wikipedia.org", "wikidata.org", "wikimedia.org",
    # Generic listing / aggregators
    "yellowpages.ro", "paginiaurii.ro", "glami.ro",
}

TICKETING_KEYWORDS = frozenset([
    "bilete", "tickets", "iabilet", "eventbook", "eventbrite", "ticketmaster",
    "rezerwuj", "buy-tickets",
])
SOCIAL_KEYWORDS = frozenset([
    "facebook", "instagram", "twitter", "tiktok", "youtube",
])


def _base_domain(url: str) -> str:
    """Return bare domain without www., e.g. 'control-club.ro'."""
    try:
        host = urlparse(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def _is_excluded(url: str) -> bool:
    domain = _base_domain(url)
    if not domain:
        return True
    for excl in EXCLUDED_DOMAINS:
        if domain == excl or domain.endswith("." + excl):
            return True
    for kw in TICKETING_KEYWORDS | SOCIAL_KEYWORDS:
        if kw in domain:
            return True
    return False


def _score_domain(url: str, venue_name: str) -> float:
    """
    Score 0–100: how likely is this URL the official venue website.
    Higher = more confident.
    """
    if _is_excluded(url):
        return 0.0

    domain = _base_domain(url)
    score  = 50.0  # neutral baseline

    # ── Fuzzy name-domain match ───────────────────────────────────────────────
    venue_norm  = re.sub(r"[^\w\s]", "", venue_name.lower())
    domain_norm = re.sub(r"[.\-_]", " ", domain.split(".")[0])  # 'control-club' → 'control club'
    ratio = fuzz.token_set_ratio(venue_norm, domain_norm)
    score += ratio * 0.35  # up to +35

    # ── Romanian TLD bonus ────────────────────────────────────────────────────
    if domain.endswith(".ro"):
        score += 8.0

    # ── Depth penalty (deeper path = less likely homepage) ───────────────────
    path  = urlparse(url).path
    depth = len([p for p in path.split("/") if p])
    score -= depth * 4.0

    # ── Page rank signal: short domains tend to be more authoritative ─────────
    if len(domain) <= 20:
        score += 5.0

    return max(0.0, min(100.0, score))


# ─────────────────────────────────────────────────────────────────────────────
# Search provider helpers
# ─────────────────────────────────────────────────────────────────────────────

_SESSION = requests.Session()
_SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    )
})


def _google_cse(query: str, api_key: str, cse_id: str) -> list:
    try:
        r = _SESSION.get(
            "https://www.googleapis.com/customsearch/v1",
            params={"q": query, "key": api_key, "cx": cse_id, "num": 5},
            timeout=10,
        )
        r.raise_for_status()
        return [item["link"] for item in r.json().get("items") or [] if item.get("link")]
    except Exception as e:
        log.warning(f"Google CSE error: {e}")
        return []


def _serpapi(query: str, api_key: str) -> list:
    try:
        r = _SESSION.get(
            "https://serpapi.com/search",
            params={"q": query, "api_key": api_key, "num": 5, "engine": "google"},
            timeout=10,
        )
        r.raise_for_status()
        return [res["link"] for res in r.json().get("organic_results") or [] if res.get("link")]
    except Exception as e:
        log.warning(f"SerpAPI error: {e}")
        return []


def _duckduckgo(query: str) -> list:
    """Free DuckDuckGo HTML scraping — no key required."""
    try:
        from bs4 import BeautifulSoup
        r = _SESSION.get(
            "https://html.duckduckgo.com/html/",
            params={"q": query},
            timeout=15,
        )
        soup  = BeautifulSoup(r.text, "lxml")
        links = []
        for a in soup.select("a.result__url"):
            href = a.get("href") or ""
            if href.startswith("http"):
                links.append(href)
            elif href:
                # DDG wraps URLs: /l/?uddg=...
                qs = parse_qs(urlparse(href).query)
                if "uddg" in qs:
                    links.append(qs["uddg"][0])
        return links[:6]
    except Exception as e:
        log.warning(f"DuckDuckGo fallback error: {e}")
        return []


# ─────────────────────────────────────────────────────────────────────────────
# VenueDiscovery
# ─────────────────────────────────────────────────────────────────────────────

class VenueDiscovery:
    """
    Discovers official venue websites via web search.

    API keys (all optional — falls back to DuckDuckGo):
      GOOGLE_CSE_API_KEY  Google Custom Search API key
      GOOGLE_CSE_ID       Google CSE engine ID
      SERPAPI_KEY         SerpAPI key
    """

    MIN_SCORE = 25.0  # below this, result is considered unreliable

    def __init__(
        self,
        google_api_key: Optional[str] = None,
        google_cse_id:  Optional[str] = None,
        serpapi_key:    Optional[str] = None,
        request_delay:  float = 1.5,
        city:           str   = "Bucharest",
    ):
        self.google_api_key = google_api_key
        self.google_cse_id  = google_cse_id
        self.serpapi_key    = serpapi_key
        self.delay          = request_delay
        self.city           = city

    def _search(self, query: str) -> list:
        """Try providers in order; return first non-empty result."""
        if self.google_api_key and self.google_cse_id:
            urls = _google_cse(query, self.google_api_key, self.google_cse_id)
            if urls:
                return urls
        if self.serpapi_key:
            urls = _serpapi(query, self.serpapi_key)
            if urls:
                return urls
        return _duckduckgo(query)

    def _build_queries(self, venue_name: str) -> list:
        city = self.city
        return [
            f'"{venue_name}" {city} site oficial',
            f'"{venue_name}" {city} events',
            f'{venue_name} {city} club bar restaurant',
        ]

    def discover(self, venue_name: str) -> Optional[str]:
        """
        Discover the official homepage for a venue.
        Returns the best URL (scheme://host only) or None.
        """
        all_urls = []
        for query in self._build_queries(venue_name)[:2]:  # 2 queries max to save quota
            urls = self._search(query)
            all_urls.extend(urls)
            if urls:
                time.sleep(self.delay)

        if not all_urls:
            log.info(f"No search results for '{venue_name}'")
            return None

        # Score and rank
        scored = [(url, _score_domain(url, venue_name)) for url in all_urls]
        scored.sort(key=lambda x: -x[1])
        log.debug(f"  Top candidates for '{venue_name}':")
        for url, sc in scored[:3]:
            log.debug(f"    {sc:.1f}  {url}")

        best_url, best_score = scored[0]
        if best_score < self.MIN_SCORE:
            log.info(f"No confident match for '{venue_name}' (best={best_score:.1f})")
            return None

        # Return just the homepage (strip path/query)
        p = urlparse(best_url)
        return f"{p.scheme}://{p.netloc}"

    def discover_batch(self, venue_names: list) -> dict:
        """
        Discover websites for a list of venues.
        Returns {venue_name: url_or_None}.
        """
        results = {}
        for i, name in enumerate(venue_names):
            log.info(f"[{i + 1}/{len(venue_names)}] Discovering: {name}")
            results[name] = self.discover(name)
            time.sleep(self.delay)
        return results
