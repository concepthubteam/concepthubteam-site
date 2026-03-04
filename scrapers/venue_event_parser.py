"""
GOZI — Venue Discovery Engine: Module 3
Multi-strategy event extractor for venue websites.

Strategies (tried in order, stops at first reliable result):
  1. JSON-LD (application/ld+json with @type: Event)
  2. Schema.org Microdata  (itemtype="…/Event")
  3. hCalendar microformat (class="vevent")
  4. Generic HTML          (repeating card blocks containing dates)

Usage:
  parser = VenueEventParser("Control Club", "https://www.control-club.ro")
  events = parser.parse_page("https://www.control-club.ro/events")
"""

import json
import logging
import re
from datetime import datetime
from typing import Optional
from urllib.parse import urljoin, urlparse

import pytz
import requests
from bs4 import BeautifulSoup
from dateutil import parser as dateutil_parser

log          = logging.getLogger(__name__)
BUCHAREST_TZ = pytz.timezone("Europe/Bucharest")

# ─────────────────────────────────────────────────────────────────────────────
# Date parsing helpers
# ─────────────────────────────────────────────────────────────────────────────

RO_MONTHS = {
    "ianuarie": "January",   "februarie": "February",  "martie": "March",
    "aprilie": "April",       "mai": "May",              "iunie": "June",
    "iulie": "July",           "august": "August",        "septembrie": "September",
    "octombrie": "October",    "noiembrie": "November",   "decembrie": "December",
    "ian": "Jan", "feb": "Feb", "mar": "Mar", "apr": "Apr",
    "iun": "Jun", "iul": "Jul", "aug": "Aug",
    "sep": "Sep", "oct": "Oct", "noi": "Nov", "dec": "Dec",
}

DATE_SCAN_PATTERNS = [
    r"\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}",                              # ISO
    r"\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}",                            # EU
    (r"\d{1,2}\s+(?:ianuarie|februarie|martie|aprilie|mai|iunie|iulie"
     r"|august|septembrie|octombrie|noiembrie|decembrie)\s+\d{4}"),      # RO long
    (r"\d{1,2}\s+(?:ian|feb|mar|apr|mai|iun|iul|aug|sep|oct|noi|dec)"
     r"\s+\d{2,4}"),                                                     # RO abbrev
    (r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)"
     r"\s+\d{1,2},?\s+\d{4}"),                                          # EN
]
_DATE_RE = re.compile(
    "|".join(f"(?:{p})" for p in DATE_SCAN_PATTERNS),
    re.IGNORECASE,
)


_ISO_DATE_RE = re.compile(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}")


def _to_iso(raw: str) -> Optional[str]:
    """Parse any date/datetime string → ISO 8601 with Europe/Bucharest tz."""
    if not raw:
        return None
    s = raw.strip()

    # Translate Romanian month names to English for dateutil
    s_work = s.lower()
    for ro, en in RO_MONTHS.items():
        s_work = re.sub(rf"\b{re.escape(ro)}\b", en, s_work, flags=re.IGNORECASE)

    # For ISO format (YYYY-MM-DD...) use dayfirst=False to avoid month/day swap
    dayfirst = not bool(_ISO_DATE_RE.match(s_work.strip()))

    try:
        dt = dateutil_parser.parse(s_work, fuzzy=True, dayfirst=dayfirst)
        if dt.tzinfo is None:
            dt = BUCHAREST_TZ.localize(dt)
        else:
            dt = dt.astimezone(BUCHAREST_TZ)
        return dt.isoformat()
    except Exception:
        return None


def _scan_date(text: str) -> Optional[str]:
    """Scan free text for the first recognisable date."""
    m = _DATE_RE.search(text)
    return _to_iso(m.group(0)) if m else None


# ─────────────────────────────────────────────────────────────────────────────
# Image / URL helpers
# ─────────────────────────────────────────────────────────────────────────────

def _abs_url(href: str, base: str) -> str:
    if not href:
        return ""
    return href if href.startswith("http") else urljoin(base, href)


def _clean_image(src: str, base: str) -> Optional[str]:
    if not src:
        return None
    src = src.strip()
    if src.startswith("data:") or not src:
        return None
    low = src.lower()
    if "placeholder" in low or "spacer" in low or src.endswith(".gif"):
        return None
    return _abs_url(src, base)


# ─────────────────────────────────────────────────────────────────────────────
# Canonical event builder
# ─────────────────────────────────────────────────────────────────────────────

def _canonical(
    *,
    title:          str,
    start_at:       str,
    end_at:         Optional[str]   = None,
    url:            str             = "",
    description:    Optional[str]   = None,
    venue_name:     str             = "",
    venue_address:  str             = "",
    ticket_url:     str             = "",
    images:         Optional[list]  = None,
    p_min=None, p_max=None,
    currency:       str             = "RON",
    is_free:        bool            = False,
    category:       str             = "events",
    _method:        str             = "generic",
) -> dict:
    try:
        from pipeline.normalize import map_category
        category = map_category(title)
    except ImportError:
        pass

    return {
        "source":          "venue_site",
        "source_event_id": f"venue_{abs(hash(url or title))}",
        "url":             url,
        "title":           title[:200],
        "description":     description,
        "category":        category,
        "start_at":        start_at,
        "end_at":          end_at,
        "venue": {
            "name":            venue_name,
            "address":         venue_address or f"{venue_name}, București",
            "lat":             None,
            "lng":             None,
            "google_place_id": None,
        },
        "price":      {"min": p_min, "max": p_max, "currency": currency},
        "is_free":    is_free,
        "ticket_url": ticket_url or url,
        "images":     images or [],
        "tags":       [category, "venue_site", "bucurești"],
        "_parse_method": _method,
    }


# ─────────────────────────────────────────────────────────────────────────────
# VenueEventParser
# ─────────────────────────────────────────────────────────────────────────────

class VenueEventParser:
    """
    Fetches an event page and extracts events using multiple strategies.
    """

    def __init__(
        self,
        venue_name:    str,
        venue_website: str,
        timeout:       int = 15,
    ):
        self.venue_name    = venue_name
        self.venue_website = venue_website
        self.timeout       = timeout
        self._session      = requests.Session()
        self._session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "ro-RO,ro;q=0.9,en;q=0.8",
        })

    # ──────────────────────────────────────────────────────────────────────────
    # Strategy 1 — JSON-LD
    # ──────────────────────────────────────────────────────────────────────────

    def _parse_jsonld(self, soup: BeautifulSoup, page_url: str) -> list:
        events = []
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or "{}")
            except (json.JSONDecodeError, TypeError):
                continue

            items = data if isinstance(data, list) else [data]
            stack = list(items)
            while stack:
                item = stack.pop()
                if not isinstance(item, dict):
                    continue
                # Unwrap @graph
                if item.get("@graph"):
                    stack.extend(item["@graph"] if isinstance(item["@graph"], list) else [item["@graph"]])
                    continue

                ev_type = item.get("@type", "")
                if isinstance(ev_type, list):
                    ev_type = " ".join(ev_type)
                if "Event" not in ev_type:
                    continue

                title    = (item.get("name") or "").strip()
                start_at = _to_iso(item.get("startDate") or item.get("startTime") or "")
                if not title or not start_at:
                    continue

                end_at    = _to_iso(item.get("endDate") or item.get("endTime") or "")
                url_field = item.get("url") or page_url

                # Location
                loc = item.get("location") or {}
                if isinstance(loc, list):
                    loc = loc[0] if loc else {}
                venue_name = loc.get("name") or self.venue_name
                venue_addr = loc.get("address") or ""
                if isinstance(venue_addr, dict):
                    venue_addr = (
                        venue_addr.get("streetAddress", "")
                        + " " + venue_addr.get("addressLocality", "")
                    ).strip()

                # Offers / ticket URL
                ticket_url = ""
                for offer in (item.get("offers") or []):
                    if isinstance(offer, dict):
                        ticket_url = offer.get("url") or ""
                        break

                # Images
                images = []
                raw_img = item.get("image") or []
                if isinstance(raw_img, str):
                    raw_img = [raw_img]
                elif isinstance(raw_img, dict):
                    raw_img = [raw_img.get("url", "")]
                for img in raw_img:
                    src = img if isinstance(img, str) else (img.get("url") or "")
                    n   = _clean_image(src, page_url)
                    if n:
                        images.append(n)

                events.append(_canonical(
                    title=title, start_at=start_at, end_at=end_at,
                    url=url_field, description=item.get("description"),
                    venue_name=venue_name, venue_address=venue_addr,
                    ticket_url=ticket_url or url_field, images=images,
                    _method="jsonld",
                ))
        return events

    # ──────────────────────────────────────────────────────────────────────────
    # Strategy 2 — Schema.org Microdata
    # ──────────────────────────────────────────────────────────────────────────

    def _parse_microdata(self, soup: BeautifulSoup, page_url: str) -> list:
        events = []
        for el in soup.find_all(attrs={"itemtype": re.compile(r"schema\.org.*(Event)", re.I)}):
            def _prop(name: str) -> str:
                child = el.find(attrs={"itemprop": name})
                if not child:
                    return ""
                return (
                    child.get("content")
                    or child.get("datetime")
                    or child.get("href")
                    or child.get_text(strip=True)
                )

            title    = _prop("name").strip()
            start_at = _to_iso(_prop("startDate") or _prop("startTime"))
            if not title or not start_at:
                continue

            end_at = _to_iso(_prop("endDate"))
            desc   = _prop("description")

            loc_el     = el.find(attrs={"itemprop": "location"})
            venue_name = ""
            venue_addr = ""
            if loc_el:
                name_el = loc_el.find(attrs={"itemprop": "name"})
                addr_el = loc_el.find(attrs={"itemprop": "address"})
                venue_name = name_el.get_text(strip=True) if name_el else ""
                venue_addr = addr_el.get_text(strip=True) if addr_el else ""

            url_field = _prop("url") or page_url

            img_el = el.find("img")
            images = []
            if img_el:
                src = img_el.get("src") or img_el.get("data-src") or ""
                n   = _clean_image(src, page_url)
                if n:
                    images.append(n)

            events.append(_canonical(
                title=title, start_at=start_at, end_at=end_at,
                url=url_field, description=desc,
                venue_name=venue_name or self.venue_name, venue_address=venue_addr,
                ticket_url=url_field, images=images, _method="microdata",
            ))
        return events

    # ──────────────────────────────────────────────────────────────────────────
    # Strategy 3 — hCalendar
    # ──────────────────────────────────────────────────────────────────────────

    def _parse_hcalendar(self, soup: BeautifulSoup, page_url: str) -> list:
        events = []
        for el in soup.find_all(class_="vevent"):
            def _cls(name: str) -> str:
                child = el.find(class_=name)
                if not child:
                    return ""
                return (
                    child.get("title")
                    or child.get("datetime")
                    or child.get_text(strip=True)
                )

            title    = _cls("summary").strip()
            start_at = _to_iso(_cls("dtstart"))
            if not title or not start_at:
                continue

            end_at = _to_iso(_cls("dtend"))
            desc   = _cls("description")
            url_el = el.find(class_="url")
            url    = (url_el.get("href") if url_el else None) or page_url

            events.append(_canonical(
                title=title, start_at=start_at, end_at=end_at,
                url=url, description=desc,
                venue_name=self.venue_name, ticket_url=url,
                _method="hcalendar",
            ))
        return events

    # ──────────────────────────────────────────────────────────────────────────
    # Strategy 4 — Generic HTML (card heuristics)
    # ──────────────────────────────────────────────────────────────────────────

    # CSS selectors tried in order of specificity
    _CARD_SELECTORS = [
        # WordPress The Events Calendar
        "article.type-tribe_events",
        ".tribe-event, .tribe-events-calendar__grid-event",
        # Common event card patterns
        "article.event, article.event-item, article[class*='event']",
        "div.event, div.event-item, div.event-card, div[class*='event-card']",
        "li.event, li.event-item, li[class*='event']",
        # Generic but filtered below
        "article, .card, .item",
    ]

    def _parse_generic(self, soup: BeautifulSoup, page_url: str) -> list:
        """
        Find repeating card elements that contain a date + a title.
        Works on most WordPress / Squarespace / custom sites.
        """
        events = []
        cards  = []

        for sel in self._CARD_SELECTORS:
            try:
                found = soup.select(sel)
            except Exception:
                continue
            if not found:
                continue

            # Filter: must have title-like element AND date-like text
            valid = []
            for card in found:
                text     = card.get_text(" ", strip=True)
                has_date = bool(_DATE_RE.search(text))
                has_title = bool(
                    card.find(["h1", "h2", "h3", "h4", "h5", "h6"])
                    or card.find(class_=re.compile(r"title|name|heading|summary", re.I))
                )
                if has_date and has_title:
                    valid.append(card)

            if len(valid) >= 2:   # ≥2 matching cards = reliable pattern
                cards = valid
                break

        for card in cards:
            ev = self._parse_card(card, page_url)
            if ev:
                events.append(ev)

        return events

    def _parse_card(self, card, page_url: str) -> Optional[dict]:
        """Parse a single event card element."""
        # ── Title ──────────────────────────────────────────────────────────────
        title_el = (
            card.find(["h1", "h2", "h3", "h4", "h5"])
            or card.find(class_=re.compile(r"title|name|heading|summary", re.I))
            or card.find("strong")
        )
        if not title_el:
            return None
        title = title_el.get_text(strip=True)
        if not title or len(title) < 3:
            return None

        # ── Date ───────────────────────────────────────────────────────────────
        start_at = None

        # 1) <time datetime="...">
        time_el = card.find("time")
        if time_el:
            start_at = _to_iso(time_el.get("datetime") or time_el.get_text(strip=True))

        # 2) Elements with date-class
        if not start_at:
            date_el = card.find(class_=re.compile(r"\bdate\b|\bwhen\b|\btime\b|\bdata\b", re.I))
            if date_el:
                start_at = _to_iso(date_el.get_text(" ", strip=True))

        # 3) Regex scan the full card text
        if not start_at:
            start_at = _scan_date(card.get_text(" ", strip=True))

        if not start_at:
            return None

        # ── URL ────────────────────────────────────────────────────────────────
        link_el   = card.find("a", href=True)
        event_url = _abs_url(link_el["href"], page_url) if link_el else page_url

        # ── Description ────────────────────────────────────────────────────────
        desc_el = card.find(class_=re.compile(r"desc|content|text|body|about|excerpt", re.I))
        desc    = desc_el.get_text(" ", strip=True)[:500] if desc_el else None

        # ── Image ──────────────────────────────────────────────────────────────
        img_el = card.find("img")
        images = []
        if img_el:
            src = (
                img_el.get("data-src")
                or img_el.get("data-lazy-src")
                or img_el.get("data-original")
                or img_el.get("src")
                or ""
            )
            n = _clean_image(src, page_url)
            if n:
                images.append(n)

        # ── Price ──────────────────────────────────────────────────────────────
        p_min = p_max = None
        currency      = "RON"
        is_free       = False
        try:
            from pipeline.normalize import parse_price
            price_el  = card.find(class_=re.compile(r"price|pret|cost", re.I))
            price_str = price_el.get_text(strip=True) if price_el else ""
            p_min, p_max, currency, is_free = parse_price(price_str)
        except ImportError:
            pass

        return _canonical(
            title=title, start_at=start_at,
            url=event_url, description=desc,
            venue_name=self.venue_name,
            ticket_url=event_url, images=images,
            p_min=p_min, p_max=p_max, currency=currency, is_free=is_free,
            _method="generic",
        )

    # ──────────────────────────────────────────────────────────────────────────
    # Deduplication
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _dedup(events: list) -> list:
        seen    = set()
        deduped = []
        for ev in events:
            key = (ev["title"].lower()[:50], (ev.get("start_at") or "")[:10])
            if key not in seen:
                seen.add(key)
                deduped.append(ev)
        return deduped

    # ──────────────────────────────────────────────────────────────────────────
    # Public entry point
    # ──────────────────────────────────────────────────────────────────────────

    def parse_page(self, url: str) -> list:
        """
        Fetch an event page and extract all events.

        Tries strategies in order:
          JSON-LD → Microdata → hCalendar → Generic HTML

        For structured data (JSON-LD / Microdata / hCalendar): stops at first
        non-empty result since structured data is authoritative.
        Generic HTML is always tried as a final fallback.
        """
        log.debug(f"Parsing {url}")
        try:
            r = self._session.get(url, timeout=self.timeout)
            if r.status_code != 200:
                log.debug(f"HTTP {r.status_code} {url}")
                return []
        except Exception as e:
            log.warning(f"Fetch error {url}: {e}")
            return []

        soup   = BeautifulSoup(r.text, "lxml")
        events = []

        for name, fn in [
            ("JSON-LD",   lambda: self._parse_jsonld(soup, url)),
            ("Microdata", lambda: self._parse_microdata(soup, url)),
            ("hCalendar", lambda: self._parse_hcalendar(soup, url)),
        ]:
            try:
                found = fn()
                if found:
                    log.debug(f"  [{name}] {len(found)} events — {url}")
                    events.extend(found)
                    break   # structured data found; skip remaining structured strategies
            except Exception as e:
                log.debug(f"  [{name}] error on {url}: {e}")

        # Always try generic as extra pass (catches events missed by structured data)
        try:
            generic = self._parse_generic(soup, url)
            if generic and not events:
                log.debug(f"  [Generic] {len(generic)} events — {url}")
                events.extend(generic)
        except Exception as e:
            log.debug(f"  [Generic] error on {url}: {e}")

        return self._dedup(events)
