"""
GOZI — Venue Discovery Engine: Module 2
Crawls a venue homepage to find event/agenda pages.

Features:
  - robots.txt compliance
  - Per-domain rate limiting
  - Event-page scoring (path + link text keywords)
  - Sitemap.xml support
  - Common-path probing (/events, /agenda, /program …)
  - Quick "does this page have events?" pre-check

Usage:
  scraper = VenueScraper()
  pages   = scraper.find_event_pages("https://www.control-club.ro")
  # → ["https://www.control-club.ro/events", ...]
"""

import logging
import re
import time
from typing import Optional
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Event-page detection heuristics
# ─────────────────────────────────────────────────────────────────────────────

EVENT_PATH_RE = re.compile(
    r"/(event|events|agenda|program|programul|calendar|whatson|what-?s-?on|"
    r"lineup|concert|concerts|show|shows|spectacol|spectacole|programare|"
    r"bilete|tickets|rezervare|gig|gigs|upcoming|schedule|nightlife|"
    r"clubbing|party|parties)(/|$|\?|\.)",
    re.IGNORECASE,
)

EVENT_TEXT_KW = {
    "events", "event", "agenda", "concert", "concerts", "show", "shows",
    "program", "calendar", "lineup", "tickets", "bilete", "spectacole",
    "schedule", "upcoming", "rezervare", "programul", "gig", "nightlife",
}

BINARY_EXTS = frozenset([
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".avif",
    ".mp4", ".mp3", ".mov", ".avi", ".zip", ".doc", ".docx", ".xls",
    ".csv", ".xml", ".json",
])

DATE_RE = re.compile(
    r"\b(20[23456]\d[-./]\d{2}[-./]\d{2}"
    r"|(?:lun|mar|mie|joi|vin|sâm|dum|mon|tue|wed|thu|fri|sat|sun)\b"
    r"|\d{1,2}\s+(?:ian|feb|mar|apr|mai|iun|iul|aug|sep|oct|noi|nov|dec)\b)",
    re.IGNORECASE,
)

USER_AGENTS = [
    (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
]

# Paths probed even if not found via link crawl
COMMON_EVENT_PATHS = [
    "/events", "/event", "/agenda", "/program", "/programul",
    "/calendar", "/whatson", "/whats-on", "/lineup",
    "/concerts", "/shows", "/spectacole", "/bilete", "/tickets",
    "/upcoming", "/schedule", "/programare",
]


def _strip_url(url: str) -> str:
    """Remove fragment and normalise trailing slash."""
    p = urlparse(url)
    clean = p._replace(fragment="", query="").geturl()
    return clean.rstrip("/")


class VenueScraper:
    """
    Crawls a venue website homepage and returns ranked event-page URLs.
    """

    def __init__(
        self,
        request_delay:  float = 2.0,
        timeout:        int   = 15,
        max_links:      int   = 30,
        respect_robots: bool  = True,
    ):
        self.delay          = request_delay
        self.timeout        = timeout
        self.max_links      = max_links
        self.respect_robots = respect_robots
        self._ua_idx        = 0
        self._robots:       dict = {}   # base_url → RobotFileParser | None
        self._domain_last:  dict = {}   # domain → last request timestamp

    # ─────────────────────────────────────────────────────────────────────────
    # HTTP helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _ua(self) -> str:
        ua = USER_AGENTS[self._ua_idx % len(USER_AGENTS)]
        self._ua_idx += 1
        return ua

    def _throttle(self, url: str):
        """Per-domain rate limiting."""
        domain = urlparse(url).netloc
        last   = self._domain_last.get(domain, 0.0)
        wait   = self.delay - (time.time() - last)
        if wait > 0:
            time.sleep(wait)
        self._domain_last[domain] = time.time()

    def _get(self, url: str, retries: int = 3) -> Optional[requests.Response]:
        """GET with retry + per-domain throttle."""
        self._throttle(url)
        for attempt in range(retries):
            try:
                r = requests.get(
                    url,
                    headers={
                        "User-Agent":      self._ua(),
                        "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
                        "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8",
                        "Accept-Encoding": "gzip, deflate, br",
                    },
                    timeout=self.timeout,
                    allow_redirects=True,
                )
                if r.status_code == 200:
                    return r
                if r.status_code in (429, 503, 504):
                    wait = 5 * (attempt + 1)
                    log.warning(f"Rate-limited {url} — waiting {wait}s")
                    time.sleep(wait)
                else:
                    log.debug(f"HTTP {r.status_code} {url}")
                    return None
            except requests.exceptions.Timeout:
                log.debug(f"Timeout {url} (attempt {attempt + 1})")
                time.sleep(2 ** attempt)
            except requests.exceptions.RequestException as e:
                log.debug(f"Request error {url}: {e}")
                return None
        return None

    # ─────────────────────────────────────────────────────────────────────────
    # robots.txt
    # ─────────────────────────────────────────────────────────────────────────

    def _can_fetch(self, base_url: str, path: str) -> bool:
        if not self.respect_robots:
            return True
        if base_url not in self._robots:
            rp = RobotFileParser()
            rp.set_url(f"{base_url}/robots.txt")
            try:
                rp.read()
                self._robots[base_url] = rp
            except Exception:
                self._robots[base_url] = None
        rp = self._robots.get(base_url)
        return rp.can_fetch("*", path) if rp else True

    # ─────────────────────────────────────────────────────────────────────────
    # Link filtering helpers
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _same_host(base_url: str, url: str) -> bool:
        base = urlparse(base_url).netloc.lstrip("www.")
        other = urlparse(url).netloc.lstrip("www.")
        return (not other) or (other == base)

    @staticmethod
    def _bad_ext(url: str) -> bool:
        path = urlparse(url).path.lower()
        return any(path.endswith(ext) for ext in BINARY_EXTS)

    # ─────────────────────────────────────────────────────────────────────────
    # Scoring
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _score(url: str, link_text: str) -> float:
        path = urlparse(url).path.lower()
        text = link_text.lower()
        score = 0.0

        # Strong: path matches event pattern
        if EVENT_PATH_RE.search(path):
            score += 65.0

        # Link text contains event keywords
        for kw in EVENT_TEXT_KW:
            if kw in text:
                score += 25.0
                break

        # Prefer shallower pages (closer to root)
        depth = len([p for p in path.split("/") if p])
        score -= depth * 5.0

        return score

    # ─────────────────────────────────────────────────────────────────────────
    # Sitemap parsing
    # ─────────────────────────────────────────────────────────────────────────

    def _sitemap_event_urls(self, base_url: str) -> list:
        """Try to extract event page URLs from sitemap.xml."""
        urls = []
        for sitemap_path in ["/sitemap.xml", "/sitemap_index.xml"]:
            r = self._get(f"{base_url}{sitemap_path}")
            if not r:
                continue
            soup = BeautifulSoup(r.text, "lxml-xml")
            for loc in soup.find_all("loc"):
                href = loc.get_text(strip=True)
                if EVENT_PATH_RE.search(href):
                    urls.append(href)
            if urls:
                break
        return urls[:10]

    # ─────────────────────────────────────────────────────────────────────────
    # Main API
    # ─────────────────────────────────────────────────────────────────────────

    def find_event_pages(self, base_url: str) -> list:
        """
        Crawl the homepage and return candidate event-page URLs,
        ordered by confidence (highest first).

        Returns up to self.max_links URLs.
        """
        base_url = _strip_url(base_url)
        log.debug(f"Crawling homepage: {base_url}")

        r = self._get(base_url)
        if not r:
            log.warning(f"Could not reach {base_url}")
            return []

        soup   = BeautifulSoup(r.text, "lxml")
        scored = {}   # url → float score

        # ── Extract links from homepage ───────────────────────────────────────
        for a in soup.find_all("a", href=True):
            raw  = a["href"].strip()
            full = _strip_url(urljoin(base_url, raw))

            if not self._same_host(base_url, full):
                continue
            if self._bad_ext(full):
                continue
            if full == base_url:
                continue

            parsed = urlparse(full)
            if not self._can_fetch(base_url, parsed.path):
                continue

            text  = a.get_text(strip=True)
            score = self._score(full, text)
            if score > 0 and full not in scored:
                scored[full] = score

        # ── Probe common event paths (even if not found via links) ────────────
        for path in COMMON_EVENT_PATHS:
            candidate = base_url + path
            if candidate not in scored:
                if self._can_fetch(base_url, path):
                    scored[candidate] = 55.0  # tentative

        # ── Check sitemap ─────────────────────────────────────────────────────
        for url in self._sitemap_event_urls(base_url):
            if url not in scored:
                scored[url] = 60.0

        # ── Sort & return ─────────────────────────────────────────────────────
        ranked = sorted(scored.items(), key=lambda x: -x[1])
        result = [url for url, _ in ranked[:self.max_links]]
        log.debug(f"  {len(result)} candidate pages for {base_url}")
        return result

    def page_has_events(self, url: str) -> bool:
        """
        Quick probe: does this page likely contain event listings?
        Returns True when the page has date-like content + event keywords.
        """
        r = self._get(url)
        if not r:
            return False
        text  = r.text.lower()
        dates = bool(DATE_RE.search(text))
        kw_count = sum(1 for kw in EVENT_TEXT_KW if kw in text)
        return dates and kw_count >= 2
