"""
Deduplication logic for canonical events.

Layer 1 (deterministic):
  hash_key = SHA1(title_norm | venue_id_or_venue_norm | start_bucket)
  → exact match = same event, skip

Layer 2 (fuzzy fallback):
  search candidates within ±6h window
  score = 0.75 * title_token_set_ratio + 0.25 * venue_similarity
  accept if score >= 0.86
"""
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Tuple

import pytz
from dateutil import parser as dateparser
from rapidfuzz import fuzz

BUCHAREST_TZ = pytz.timezone("Europe/Bucharest")
BUCKET_MINUTES = 15
FUZZY_THRESHOLD = 86          # out of 100
FUZZY_WINDOW_HOURS = 6

# Source priority for best-field selection (higher = more trusted)
SOURCE_PRIORITY: dict[str, int] = {
    "eventbook":  100,
    "iabilet":     90,
    "ra":          80,
    "zilesinopti": 70,
    "iesim":       60,
    "venue_site":  50,
    "hardpedia":   40,
}


def time_bucket(start_at: str) -> str:
    """Floor start_at to nearest BUCKET_MINUTES boundary → ISO string"""
    dt = dateparser.parse(start_at)
    if dt.tzinfo is None:
        dt = BUCHAREST_TZ.localize(dt)
    bucketed = dt.replace(
        minute=(dt.minute // BUCKET_MINUTES) * BUCKET_MINUTES,
        second=0,
        microsecond=0,
    )
    return bucketed.isoformat()


def compute_hash_key(
    title_norm: str,
    venue_id: Optional[str],
    venue_norm: str,
    start_at: str,
) -> str:
    """
    Deterministic SHA1 hash for deduplication.
    Uses venue_id (UUID) when available, falls back to normalized venue name.
    """
    bucket = time_bucket(start_at)
    if venue_id:
        raw = f"{title_norm}|{venue_id}|{bucket}"
    else:
        raw = f"{title_norm}|{venue_norm}|{bucket}|bucharest"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def fuzzy_score(
    title_a: str,
    venue_a: str,
    title_b: str,
    venue_b: str,
) -> float:
    """
    Weighted similarity score (0–100).
    title_token_set_ratio × 0.75 + venue_ratio × 0.25
    If no venue info, use title only.
    """
    t_score = fuzz.token_set_ratio(title_a, title_b)
    if venue_a and venue_b:
        v_score = fuzz.ratio(venue_a, venue_b)
        return 0.75 * t_score + 0.25 * v_score
    return float(t_score)


def within_window(start_a: str, start_b: str, hours: int = FUZZY_WINDOW_HOURS) -> bool:
    """True if two ISO timestamps are within `hours` of each other"""
    try:
        dt_a = dateparser.parse(start_a)
        dt_b = dateparser.parse(start_b)
        if dt_a.tzinfo is None:
            dt_a = BUCHAREST_TZ.localize(dt_a)
        if dt_b.tzinfo is None:
            dt_b = BUCHAREST_TZ.localize(dt_b)
        return abs((dt_a - dt_b).total_seconds()) <= hours * 3600
    except Exception:
        return False


def source_priority(source: str) -> int:
    return SOURCE_PRIORITY.get(source, 0)


def window_bounds(start_at: str, hours: int = FUZZY_WINDOW_HOURS) -> Tuple[str, str]:
    """Return (iso_start, iso_end) for ±hours window around start_at"""
    dt = dateparser.parse(start_at)
    if dt.tzinfo is None:
        dt = BUCHAREST_TZ.localize(dt)
    return (
        (dt - timedelta(hours=hours)).isoformat(),
        (dt + timedelta(hours=hours)).isoformat(),
    )
