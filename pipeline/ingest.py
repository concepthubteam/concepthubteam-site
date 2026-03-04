"""
Ingestion pipeline: canonical event dict → Supabase upsert.

For each event:
  1. Normalize title + venue
  2. Upsert venue → get venue_id
  3. Compute hash_key
  4. L1: match by hash_key
  5. L2: fuzzy match in ±6h window
  6. Insert new OR merge into existing (best-field selection)
  7. Log to source_events
"""
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from supabase import create_client, Client

from pipeline.normalize import (
    normalize_title, normalize_venue, map_category, parse_price
)
from pipeline.dedupe import (
    compute_hash_key, fuzzy_score, window_bounds,
    source_priority, FUZZY_THRESHOLD
)

log = logging.getLogger(__name__)


def _client() -> Client:
    # Accept both env var names: Expo convention and legacy plain name
    url = (
        os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or
        os.environ.get("SUPABASE_URL") or
        ""
    )
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise EnvironmentError(
            "Missing Supabase credentials. "
            "Set EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env"
        )
    return create_client(url, key)


# ── Venue upsert ──────────────────────────────────────────────────────────────

def upsert_venue(sb: Client, venue: dict) -> Optional[str]:
    """
    Insert or find venue by normalized name.
    Returns venue UUID or None.
    """
    name = (venue.get("name") or "").strip()
    if not name or name.lower() in {"unknown", "tba", "tbd", ""}:
        return None

    name_norm = normalize_venue(name)

    res = sb.table("venues").select("id").eq("name_normalized", name_norm).limit(1).execute()
    if res.data:
        return res.data[0]["id"]

    try:
        ins = sb.table("venues").insert({
            "name":            name,
            "name_normalized": name_norm,
            "address":         venue.get("address"),
            "lat":             venue.get("lat"),
            "lng":             venue.get("lng"),
            "google_place_id": venue.get("google_place_id"),
        }).execute()
        return ins.data[0]["id"] if ins.data else None
    except Exception as e:
        log.warning(f"venue insert error ({name}): {e}")
        return None


# ── Canonical match ───────────────────────────────────────────────────────────

def find_match(
    sb: Client,
    hash_key: str,
    title_norm: str,
    venue_norm: str,
    start_at: str,
) -> tuple[Optional[int], str, float]:
    """
    Returns (canonical_event_id, match_method, confidence).
    match_method: 'hash_key' | 'fuzzy' | None
    """
    # L1 — deterministic hash
    res = sb.table("events").select("id").eq("hash_key", hash_key).limit(1).execute()
    if res.data:
        return res.data[0]["id"], "hash_key", 1.0

    # L2 — fuzzy within ±6h window
    try:
        w_start, w_end = window_bounds(start_at)
        candidates = (
            sb.table("events")
            .select("id, title_normalized, venue")
            .gte("start_at", w_start)
            .lte("start_at", w_end)
            .execute()
        )
        best_id, best_score = None, 0.0
        for c in candidates.data or []:
            score = fuzzy_score(
                title_norm,
                venue_norm,
                c.get("title_normalized") or "",
                normalize_venue(c.get("venue") or ""),
            )
            if score > best_score:
                best_score, best_id = score, c["id"]

        if best_id and best_score >= FUZZY_THRESHOLD:
            return best_id, "fuzzy", best_score / 100.0
    except Exception as e:
        log.warning(f"fuzzy search error: {e}")

    return None, "new", 0.0


# ── Single event ingest ───────────────────────────────────────────────────────

def ingest_event(sb: Client, event: dict) -> dict:
    """
    Ingest one canonical event dict.
    Returns {"status": "new"|"merged"|"error", "id": int|None}
    """
    source = event.get("source", "unknown")

    try:
        # 1. Normalize
        title_norm = normalize_title(event["title"])
        venue_data = event.get("venue") or {}
        venue_norm = normalize_venue(venue_data.get("name") or "")

        # 2. Price
        p = event.get("price") or {}
        price_min  = p.get("min")
        price_max  = p.get("max")
        currency   = p.get("currency") or "RON"
        is_free    = bool(event.get("is_free"))
        if is_free:
            price_min = price_min or 0.0
            price_max = price_max or 0.0

        # 3. Venue upsert
        venue_id = upsert_venue(sb, venue_data)

        # 4. Hash key
        hash_key = compute_hash_key(title_norm, venue_id, venue_norm, event["start_at"])

        # 5. Find existing canonical event
        canonical_id, method, confidence = find_match(
            sb, hash_key, title_norm, venue_norm, event["start_at"]
        )

        priority = source_priority(source)

        if canonical_id:
            # ── Merge: apply best-field selection ──────────────────────────
            ex = (sb.table("events").select("*").eq("id", canonical_id).single().execute()).data or {}
            ex_priority = source_priority(ex.get("source_best") or "")

            updates = {}
            if priority > ex_priority:
                updates["source_best"] = source

            # Keep longest description
            new_desc = event.get("description") or ""
            ex_desc  = ex.get("description") or ""
            if new_desc and len(new_desc) > len(ex_desc):
                updates["description"] = new_desc

            # Ticket URL from ticketing sources
            if event.get("ticket_url") and (
                not ex.get("ticket_url") or priority >= source_priority("iabilet")
            ):
                updates["ticket_url"]  = event["ticket_url"]
                updates["tickets_url"] = event["ticket_url"]

            # Image: fill if missing
            if not ex.get("image_url") and event.get("images"):
                updates["image_url"] = event["images"][0]
                updates["image"]     = event["images"][0]

            # Price: fill if missing
            if price_min is not None and ex.get("price_min") is None:
                updates.update({
                    "price_min": price_min,
                    "price_max": price_max,
                    "currency":  currency,
                    "is_free":   is_free,
                })

            if updates:
                sb.table("events").update(updates).eq("id", canonical_id).execute()

            status = "merged"

        else:
            # ── New canonical event ─────────────────────────────────────────
            image_url = (event.get("images") or [None])[0]
            category  = map_category(event.get("category") or "")

            # Build human-readable price string (legacy column)
            if is_free:
                price_display = "Gratuit"
            elif price_min is not None:
                price_display = (
                    f"{int(price_min)}-{int(price_max)} {currency}"
                    if price_max and price_max != price_min
                    else f"{int(price_min)} {currency}"
                )
            else:
                price_display = "Vezi site"

            row = {
                "title":            event["title"],
                "title_normalized": title_norm,
                "category":         category,
                "category_label":   category.title(),
                "description":      event.get("description"),
                "date":             None,
                "date_iso":         None,
                "start_at":         event["start_at"],
                "end_at":           event.get("end_at"),
                "time":             event["start_at"][11:16] if event.get("start_at") else None,
                "venue":            venue_data.get("name", ""),
                "venue_id":         venue_id,
                "venue_name_raw":   venue_data.get("name"),
                "address":          venue_data.get("address"),
                "address_raw":      venue_data.get("address"),
                "lat":              venue_data.get("lat"),
                "lng":              venue_data.get("lng"),
                "price":            price_display,
                "price_min":        price_min,
                "price_max":        price_max,
                "currency":         currency,
                "is_free":          is_free,
                "ticket_url":       event.get("ticket_url"),
                "tickets_url":      event.get("ticket_url"),
                "image_url":        image_url,
                "image":            image_url,
                "images":           json.dumps(event.get("images") or []),
                "tags":             event.get("tags") or [],
                "hash_key":         hash_key,
                "source_best":      source,
                "status":           "published",
                "rating":           4.0,
                "featured":         False,
                "website":          event.get("url"),
            }

            res = sb.table("events").insert(row).execute()
            canonical_id = res.data[0]["id"] if res.data else None
            status = "new"

        # 6. Log source_event
        sb.table("source_events").upsert(
            {
                "source":              source,
                "source_event_id":     event.get("source_event_id", ""),
                "url":                 event.get("url"),
                "fetched_at":          datetime.now(timezone.utc).isoformat(),
                "payload":             json.dumps(event),
                "title_raw":           event.get("title"),
                "venue_raw":           venue_data.get("name"),
                "start_at_raw":        event.get("start_at"),
                "canonical_event_id":  canonical_id,
                "canonical_venue_id":  venue_id,
                "match_confidence":    round(confidence, 4),
                "match_method":        method,
            },
            on_conflict="source,source_event_id",
        ).execute()

        return {"status": status, "id": canonical_id}

    except Exception as e:
        log.error(f"ingest_event error [{event.get('title')}]: {e}", exc_info=True)
        return {"status": "error", "id": None, "error": str(e)}


# ── Batch ingest ──────────────────────────────────────────────────────────────

def ingest_batch(events: list[dict], source_label: str = "") -> dict:
    """
    Ingest a list of canonical event dicts.
    Returns {"new": N, "merged": N, "error": N, "total": N}
    """
    sb = _client()
    stats: dict[str, int] = {"new": 0, "merged": 0, "error": 0}

    label = f"[{source_label}] " if source_label else ""
    total = len(events)

    for i, event in enumerate(events):
        result = ingest_event(sb, event)
        key = result.get("status", "error")
        stats[key] = stats.get(key, 0) + 1

        if (i + 1) % 50 == 0 or (i + 1) == total:
            log.info(f"{label}{i+1}/{total} — {stats}")

    stats["total"] = total
    return stats
