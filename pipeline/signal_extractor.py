"""
GOZI — TikTok Signal Extractor
Extracts structured intelligence from TikTok video captions + hashtags.

Signals extracted:
  - venue_name: club/bar/venue mentions (e.g. "Control", "Quantic", "Expirat")
  - event_date: date/time references (e.g. "vineri 21:00", "10 martie")
  - ticket_url: ticketing links (iabilet.ro, eventim.ro, tazz, beacons.ai, ...)
  - price:      price mentions (e.g. "50 lei", "entry 30 RON")
  - promo_code: promo / discount codes

Usage:
  extractor = SignalExtractor()
  signals = extractor.extract(caption, hashtags)
  # => [{"type": "venue_name", "value": "Control", "confidence": 0.85}, ...]
"""

import logging
import re
from typing import Optional

log = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Known Bucharest venues / clubs (seed list, extend via DB)
# ─────────────────────────────────────────────────────────────────────────────

KNOWN_VENUES = {
    "control":        "Control Club",
    "controlclub":    "Control Club",
    "quantic":        "Quantic",
    "expirat":        "Expirat",
    "fabrica":        "Fabrica",
    "midi":           "Midi Club",
    "midi live":      "Midi Live Music Club",
    "koko":           "Koko Club",
    "lente":          "Lente",
    "interbelic":     "Interbelic",
    "pubs":           "Pubs",
    "panic":          "Panic Club",
    "omega":          "Omega Club",
    "club a":         "Club A",
    "beraria h":      "Beraria H",
    "gradina botanica": "Grădina Botanică",
    "gradina electronica": "Grădina Electronică",
}

# ─────────────────────────────────────────────────────────────────────────────
# Regex patterns
# ─────────────────────────────────────────────────────────────────────────────

# Date/time patterns (Romanian + English)
DATE_PATTERNS = [
    # Full ISO: 2026-03-15, 2026/03/15
    (r"\b(20\d{2}[-/]\d{2}[-/]\d{2})\b", 0.95),
    # Day + month name: "15 martie", "15 march", "15 apr"
    (r"\b(\d{1,2})\s+(ian(?:uarie)?|feb(?:ruarie)?|mar(?:tie)?|apr(?:ilie)?|"
     r"mai|iun(?:ie)?|iul(?:ie)?|aug(?:ust)?|sep(?:tembrie)?|oct(?:ombrie)?|"
     r"noi(?:embre)?|nov(?:embre)?|dec(?:embrie)?|january|february|march|april|"
     r"june|july|august|september|october|november|december)\b", 0.90),
    # Weekday + time: "vineri 22:00", "sambata 23:00", "friday 9pm"
    (r"\b(lun(?:i)?|mar(?:ți|ti)?|mie(?:rcuri)?|joi|vin(?:eri)?|"
     r"s[aâ]m(?:b[aă]t[aă])?|dum(?:inic[aă])?|"
     r"mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|"
     r"fri(?:day)?|sat(?:urday)?|sun(?:day)?)"
     r"\s+(\d{1,2}[:.]\d{2}|\d{1,2}(?:pm|am))", 0.85),
    # Time only: "22:00", "ora 22"
    (r"\b(ora\s+\d{1,2}|\d{1,2}:\d{2}(?:\s*(?:pm|am))?)\b", 0.60),
]

# Ticket / booking URL patterns
TICKET_URL_RE = re.compile(
    r"https?://(?:www\.)?"
    r"(?:iabilet\.ro|eventim\.ro|eventbrite\.\w+|bilete\.ro|"
    r"tazz\.ro|beacons\.ai|linktr\.ee|campfire\.to|"
    r"ra\.co|residentadvisor\.net)/\S+",
    re.IGNORECASE,
)

# Price patterns (Romanian)
PRICE_RE = re.compile(
    r"\b(\d{1,4})\s*(?:lei|ron|RON|Euro?|EUR|€)\b"
    r"|\bentry\s*[:=]?\s*(\d{1,4})\b"
    r"|\bintrare\s*[:=]?\s*(\d{1,4})\b"
    r"|\bbilet(?:e)?\s*[:=]?\s*(\d{1,4})\b",
    re.IGNORECASE,
)

# Promo code patterns
PROMO_RE = re.compile(
    r"\b(?:cod(?:e)?|promo|discount|reducere|guestlist)\s*[:=]?\s*([A-Z0-9_\-]{4,20})\b",
    re.IGNORECASE,
)


# ─────────────────────────────────────────────────────────────────────────────
# SignalExtractor
# ─────────────────────────────────────────────────────────────────────────────

class SignalExtractor:
    """
    Extracts structured signals from TikTok caption + hashtags.
    Optionally loads known venue list from Supabase.
    """

    def __init__(self, extra_venues: Optional[dict] = None):
        self.venues = {**KNOWN_VENUES}
        if extra_venues:
            self.venues.update({k.lower(): v for k, v in extra_venues.items()})

    def load_venues_from_db(self, supabase) -> int:
        """Populate venue list from DB for better recall."""
        try:
            resp = supabase.table("venues").select("name").execute()
            for row in resp.data or []:
                name = (row.get("name") or "").strip()
                if name:
                    self.venues[name.lower()] = name
            log.info(f"Loaded {len(self.venues)} venues for signal extraction")
            return len(resp.data or [])
        except Exception as e:
            log.warning(f"Could not load venues from DB: {e}")
            return 0

    # ── Extraction helpers ────────────────────────────────────────────────────

    def _extract_venues(self, text: str) -> list:
        text_lower = text.lower()
        signals = []
        for key, canonical_name in self.venues.items():
            # Whole-word match
            pattern = r"\b" + re.escape(key) + r"\b"
            if re.search(pattern, text_lower):
                signals.append({
                    "type":       "venue_name",
                    "value":      canonical_name,
                    "confidence": 0.85,
                })
        return signals

    @staticmethod
    def _extract_dates(text: str) -> list:
        signals = []
        seen = set()
        for pattern, conf in DATE_PATTERNS:
            for m in re.finditer(pattern, text, re.IGNORECASE):
                value = m.group(0).strip()
                if value.lower() not in seen:
                    seen.add(value.lower())
                    signals.append({
                        "type":       "event_date",
                        "value":      value,
                        "confidence": conf,
                    })
        return signals

    @staticmethod
    def _extract_ticket_urls(text: str) -> list:
        signals = []
        for m in TICKET_URL_RE.finditer(text):
            signals.append({
                "type":       "ticket_url",
                "value":      m.group(0),
                "confidence": 0.92,
            })
        return signals

    @staticmethod
    def _extract_prices(text: str) -> list:
        signals = []
        for m in PRICE_RE.finditer(text):
            # Find which group matched
            value = next((g for g in m.groups() if g), "")
            if value:
                full_match = m.group(0).strip()
                signals.append({
                    "type":       "price",
                    "value":      full_match,
                    "confidence": 0.80,
                })
        return signals

    @staticmethod
    def _extract_promo_codes(text: str) -> list:
        signals = []
        for m in PROMO_RE.finditer(text):
            signals.append({
                "type":       "promo_code",
                "value":      m.group(0).strip(),
                "confidence": 0.75,
            })
        return signals

    # ── Main API ──────────────────────────────────────────────────────────────

    def extract(self, caption: str, hashtags: Optional[list] = None) -> list:
        """
        Extract all signals from a video caption + hashtag list.
        Returns list of signal dicts: {type, value, confidence}
        """
        text = (caption or "")
        if hashtags:
            text = text + " " + " ".join(hashtags)

        signals: list = []

        # Venue detection
        signals.extend(self._extract_venues(text))

        # Date / time
        signals.extend(self._extract_dates(text))

        # Ticket URLs
        signals.extend(self._extract_ticket_urls(text))

        # Prices
        signals.extend(self._extract_prices(text))

        # Promo codes
        signals.extend(self._extract_promo_codes(text))

        # Deduplicate by (type, value)
        seen = set()
        unique = []
        for s in signals:
            key = (s["type"], s["value"].lower())
            if key not in seen:
                seen.add(key)
                unique.append(s)

        log.debug(f"Extracted {len(unique)} signals from {len(text)} chars")
        return unique
