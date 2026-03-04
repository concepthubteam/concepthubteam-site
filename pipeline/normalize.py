"""
Text normalization helpers: titles, venues, categories, prices.
All scrapers should use these before producing canonical events.
"""
import re
import unicodedata
from typing import Optional, Tuple


# ── Venue alias map ──────────────────────────────────────────────────────────
# normalized_input → canonical_name
VENUE_ALIASES: dict[str, str] = {
    "control club":               "control",
    "control club bucharest":     "control",
    "club control":               "control",
    "expirat halele carol":       "expirat",
    "expirat":                    "expirat",
    "fabrica":                    "fabrica",
    "fabrica club":               "fabrica",
    "beraria h":                  "beraria h",
    "gradina botanica":           "gradina botanica",
    "gradina botanica bucuresti": "gradina botanica",
    "teatrul national":           "teatrul national",
    "tnb":                        "teatrul national",
    "teatrul national ion luca caragiale": "teatrul national",
    "opera nationala bucuresti":  "opera nationala",
    "onb":                        "opera nationala",
    "sala palatului":             "sala palatului",
    "arenele romane":             "arenele romane",
    "arena nationala":            "arena nationala",
    "energiea arena":             "arena nationala",
    "national arena":             "arena nationala",
    "circul globus":              "globus",
    "globus":                     "globus",
    "cinema pro":                 "cinema pro",
    "cinema city":                "cinema city",
    "cinema city baneasa":        "cinema city baneasa",
    "cinemateca":                 "cinemateca",
    "kruhnen musik halle":        "kruhnen musik halle",
    "club midi":                  "midi",
    "midi club":                  "midi",
    "quantic":                    "quantic",
    "quantic club":               "quantic",
    "eden club":                  "eden",
    "eden":                       "eden",
    "form space":                 "form space",
    "lacul morii":                "lacul morii",
    "parcul herastrau":           "herastrau",
    "parcul regele mihai":        "herastrau",
    "herastrau":                  "herastrau",
    "parcul tineretului":         "parcul tineretului",
    "teatrul metropolis":         "metropolis",
    "teatrul odeon":              "odeon",
    "teatrul nottara":            "nottara",
}

# ── Category map ─────────────────────────────────────────────────────────────
# raw_keyword → gozi_category
CATEGORY_MAP: dict[str, str] = {
    # club / nightlife
    "club":       "club",
    "clubbing":   "club",
    "nightlife":  "club",
    "techno":     "club",
    "party":      "club",
    "after party":"club",
    "dj set":     "club",
    # music / concerts
    "concert":    "music",
    "concerte":   "music",
    "live music": "music",
    "muzica":     "music",
    "rock":       "music",
    "jazz":       "music",
    "pop":        "music",
    "hip hop":    "music",
    # festivals
    "festival":   "festival",
    "festivaluri":"festival",
    # theatre
    "theatre":    "theatre",
    "teatru":     "theatre",
    "opera":      "theatre",
    "balet":      "theatre",
    "dans":       "theatre",
    "spectacol":  "theatre",
    # cinema
    "cinema":     "cinema",
    "film":       "cinema",
    "movie":      "cinema",
    # kids
    "kids":       "kids",
    "copii":      "kids",
    "familie":    "kids",
    "family":     "kids",
    "pentru copii":"kids",
    # sport
    "sport":      "sport",
    "fitness":    "sport",
    "yoga":       "sport",
    "alergare":   "sport",
    "maratonul":  "sport",
    "crossfit":   "sport",
    "tenis":      "sport",
    # outdoor
    "outdoor":    "outdoor",
    "parc":       "outdoor",
    "parcuri":    "outdoor",
    "natura":     "outdoor",
    "hiking":     "outdoor",
    "picnic":     "outdoor",
    # food
    "restaurant": "food",
    "food":       "food",
    "street food":"food",
    "gastronomic":"food",
    "brunch":     "food",
    "beer":       "food",
    "bere":       "food",
    "wine":       "food",
    "vin":        "food",
    # expo / art
    "expozitie":  "expo",
    "expo":       "expo",
    "exhibition": "expo",
    "arta":       "expo",
    "art":        "expo",
    "galerie":    "expo",
    "muzeu":      "expo",
    # talks / workshops
    "conferinta": "talks",
    "talks":      "talks",
    "seminar":    "talks",
    "workshop":   "talks",
    "training":   "talks",
    "standup":    "talks",
    "comedy":     "talks",
    "stand up":   "talks",
}


# ── Core normalizer ───────────────────────────────────────────────────────────

def normalize(text: str) -> str:
    """lowercase + strip diacritics + remove punct + collapse whitespace"""
    if not text:
        return ""
    # NFD decomposition → strip combining chars (diacritics)
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_title(title: str) -> str:
    """Strips venue suffix patterns, then normalizes"""
    if not title:
        return ""
    # "Event Name @ Venue Name"
    title = re.sub(r"\s*@\s*[\w\s,''\-\.]{2,40}$", "", title, flags=re.IGNORECASE)
    # "Event Name | Venue"
    title = re.sub(r"\s*\|\s*.+$", "", title)
    # "Event Name (Venue)" at end
    title = re.sub(r"\s*\([\w\s,'\-\.]{2,30}\)\s*$", "", title)
    # "Event Name - Venue" at end (only if suffix ≥ 3 words would be wrong — be conservative)
    title = re.sub(r"\s*[-–]\s*[\w\s]{3,25}$", "", title)
    return normalize(title.strip())


def normalize_venue(name: str) -> str:
    """Apply alias map; return canonical lowercase venue name"""
    if not name:
        return ""
    n = normalize(name)
    return VENUE_ALIASES.get(n, n)


def map_category(raw: str) -> str:
    """Map raw source category string → GOZI category"""
    if not raw:
        return "events"
    r = raw.lower().strip()
    # exact match first
    if r in CATEGORY_MAP:
        return CATEGORY_MAP[r]
    # substring scan
    for key, cat in CATEGORY_MAP.items():
        if key in r:
            return cat
    return "events"


# ── Price parser ──────────────────────────────────────────────────────────────

def parse_price(price_str: str) -> Tuple[Optional[float], Optional[float], str, bool]:
    """
    Returns (price_min, price_max, currency, is_free)
    Examples: "Gratuit" → (0,0,"RON",True)
              "40 RON"  → (40,40,"RON",False)
              "40-120 RON" → (40,120,"RON",False)
    """
    if not price_str:
        return None, None, "RON", False

    p = price_str.strip().lower()

    FREE_WORDS = {"gratuit", "free", "gratis", "intrare libera", "intrare liberă", "0 ron"}
    if any(w in p for w in FREE_WORDS) or p in {"0", "0.0"}:
        return 0.0, 0.0, "RON", True

    currency = "RON"
    if "eur" in p or "€" in p:
        currency = "EUR"

    nums = re.findall(r"\d+(?:[.,]\d+)?", price_str)
    if not nums:
        return None, None, currency, False

    vals = [float(n.replace(",", ".")) for n in nums]
    return min(vals), max(vals), currency, False


# ── Romanian month parser ─────────────────────────────────────────────────────

RO_MONTHS = {
    "ian": 1, "feb": 2, "mar": 3, "apr": 4,
    "mai": 5, "iun": 6, "iul": 7, "aug": 8,
    "sep": 9, "oct": 10, "noi": 11, "dec": 12,
    # full names
    "ianuarie": 1, "februarie": 2, "martie": 3, "aprilie": 4,
    "iunie": 6, "iulie": 7, "august": 8, "septembrie": 9,
    "octombrie": 10, "noiembrie": 11, "decembrie": 12,
}

EN_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def parse_ro_date(date_str: str, default_hour: int = 20) -> Optional[str]:
    """
    Parse Romanian/ISO date strings → ISO 8601 with Bucharest tz.
    Handles: "18 mai 2026", "18.05.2026", "2026-05-18", "18/05/2026"
    Returns None if unparseable.
    """
    import pytz
    from datetime import datetime

    BUCHAREST = pytz.timezone("Europe/Bucharest")

    if not date_str:
        return None

    s = date_str.strip().lower()

    # ISO format: 2026-05-18
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return BUCHAREST.localize(datetime(y, mo, d, default_hour, 0)).isoformat()
        except ValueError:
            pass

    # DD.MM.YYYY or DD/MM/YYYY
    m = re.match(r"^(\d{1,2})[./](\d{1,2})[./](\d{4})", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return BUCHAREST.localize(datetime(y, mo, d, default_hour, 0)).isoformat()
        except ValueError:
            pass

    # "18 mai 2026" or "18 may 2026"
    m = re.search(r"(\d{1,2})\s+([a-z]+)\s+(\d{4})", s)
    if m:
        d = int(m.group(1))
        month_str = m.group(2)[:3]
        y = int(m.group(3))
        mo = RO_MONTHS.get(month_str) or EN_MONTHS.get(month_str)
        if mo:
            try:
                return BUCHAREST.localize(datetime(y, mo, d, default_hour, 0)).isoformat()
            except ValueError:
                pass

    return None
