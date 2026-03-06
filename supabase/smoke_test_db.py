"""
GOZI — DB Smoke Test
====================
Connects to Supabase via service-role key and verifies that every table,
view and critical column defined in schema_v2.sql + schema_tiktok.sql
actually exists in the live database.

Strategy: issue lightweight SELECT queries against each table/column and
interpret PostgREST error codes to distinguish "missing table" (PGRST200/205)
from "missing column" (PGRST204).  No information_schema needed.

Exit code 0 → all checks PASS
Exit code 1 → one or more checks FAIL

Usage:
    cd /Users/remusenus/Desktop/gozi-app
    python3 supabase/smoke_test_db.py
    python3 supabase/smoke_test_db.py --verbose
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

# ─────────────────────────────────────────────────────────────────────────────
# Manifest — (table_or_view, column_or_None)
# None  → just assert the relation exists
# ─────────────────────────────────────────────────────────────────────────────

SCHEMA_BASE: list[tuple[str, Optional[str]]] = [
    ("events",      None),
    ("user_saved",  None),
    ("events",      "id"),
    ("events",      "title"),
    ("events",      "date_iso"),
    ("events",      "source"),
]

SCHEMA_V2: list[tuple[str, Optional[str]]] = [
    # venues
    ("venues",            None),
    ("venues",            "id"),
    ("venues",            "name"),
    ("venues",            "name_normalized"),
    ("venues",            "address"),
    ("venues",            "city"),
    ("venues",            "lat"),
    ("venues",            "lng"),
    ("venues",            "google_place_id"),
    ("venues",            "website"),
    ("venues",            "instagram"),
    ("venues",            "facebook"),
    ("venues",            "website_crawled_at"),
    ("venues",            "created_at"),
    ("venues",            "updated_at"),
    # source_events
    ("source_events",     None),
    ("source_events",     "source"),
    ("source_events",     "source_event_id"),
    ("source_events",     "url"),
    ("source_events",     "fetched_at"),
    ("source_events",     "payload"),
    ("source_events",     "title_raw"),
    ("source_events",     "venue_raw"),
    ("source_events",     "start_at_raw"),
    ("source_events",     "canonical_event_id"),
    ("source_events",     "canonical_venue_id"),
    ("source_events",     "match_confidence"),
    ("source_events",     "match_method"),
    # event_submissions
    ("event_submissions", None),
    ("event_submissions", "payload"),
    ("event_submissions", "status"),
    # extended events columns
    ("events",            "hash_key"),
    ("events",            "title_normalized"),
    ("events",            "venue_id"),
    ("events",            "venue_name_raw"),
    ("events",            "address_raw"),
    ("events",            "start_at"),
    ("events",            "end_at"),
    ("events",            "all_day"),
    ("events",            "price_min"),
    ("events",            "price_max"),
    ("events",            "currency"),
    ("events",            "is_free"),
    ("events",            "ticket_url"),
    ("events",            "image_url"),
    ("events",            "images"),
    ("events",            "source_best"),
    ("events",            "status"),
    # views
    ("v_upcoming_events", None),
    ("v_dedupe_audit",    None),
]

SCHEMA_TIKTOK: list[tuple[str, Optional[str]]] = [
    # tiktok_accounts
    ("tiktok_accounts",          None),
    ("tiktok_accounts",          "id"),
    ("tiktok_accounts",          "username"),
    ("tiktok_accounts",          "url"),
    ("tiktok_accounts",          "display_name"),
    ("tiktok_accounts",          "bio"),
    ("tiktok_accounts",          "avatar_url"),
    ("tiktok_accounts",          "followers"),
    ("tiktok_accounts",          "following"),
    ("tiktok_accounts",          "likes_total"),
    ("tiktok_accounts",          "linked_venue_id"),
    ("tiktok_accounts",          "category"),
    ("tiktok_accounts",          "status"),
    ("tiktok_accounts",          "refresh_interval_h"),
    ("tiktok_accounts",          "last_checked_at"),
    ("tiktok_accounts",          "created_at"),
    ("tiktok_accounts",          "updated_at"),
    # tiktok_videos
    ("tiktok_videos",            None),
    ("tiktok_videos",            "account_id"),
    ("tiktok_videos",            "video_url"),
    ("tiktok_videos",            "tiktok_id"),
    ("tiktok_videos",            "caption"),
    ("tiktok_videos",            "hashtags"),
    ("tiktok_videos",            "thumbnail_url"),
    ("tiktok_videos",            "posted_at"),
    ("tiktok_videos",            "views"),
    ("tiktok_videos",            "likes"),
    ("tiktok_videos",            "comments"),
    ("tiktok_videos",            "shares"),
    ("tiktok_videos",            "raw_json"),
    ("tiktok_videos",            "processed"),
    ("tiktok_videos",            "last_checked_at"),
    ("tiktok_videos",            "created_at"),
    # signals
    ("signals",                  None),
    ("signals",                  "video_id"),
    ("signals",                  "type"),
    ("signals",                  "value"),
    ("signals",                  "confidence"),
    ("signals",                  "matched_venue_id"),
    ("signals",                  "matched_event_id"),
    ("signals",                  "review_status"),
    ("signals",                  "reviewer_note"),
    ("signals",                  "extracted_at"),
    # tiktok_runs
    ("tiktok_runs",              None),
    ("tiktok_runs",              "account_id"),
    ("tiktok_runs",              "provider"),
    ("tiktok_runs",              "status"),
    ("tiktok_runs",              "videos_fetched"),
    ("tiktok_runs",              "videos_new"),
    ("tiktok_runs",              "signals_new"),
    ("tiktok_runs",              "error_msg"),
    ("tiktok_runs",              "duration_s"),
    ("tiktok_runs",              "started_at"),
    ("tiktok_runs",              "finished_at"),
    # views
    ("v_signals_inbox",          None),
    ("v_tiktok_account_health",  None),
]

ALL_CHECKS = SCHEMA_BASE + SCHEMA_V2 + SCHEMA_TIKTOK


# ─────────────────────────────────────────────────────────────────────────────
# Console helpers
# ─────────────────────────────────────────────────────────────────────────────

_G = "\033[32m"; _R = "\033[31m"; _Y = "\033[33m"
_B = "\033[1m";  _C = "\033[36m"; _0 = "\033[0m"

def _ok(m):   print(f"  {_G}✓{_0}  {m}")
def _fail(m): print(f"  {_R}✗{_0}  {m}")
def _hdr(m):  print(f"\n{_B}{m}{_0}")


# ─────────────────────────────────────────────────────────────────────────────
# Low-level probes using PostgREST error codes
# ─────────────────────────────────────────────────────────────────────────────

# PGRST codes that mean "table/view not found"
_TABLE_MISSING_CODES = {"PGRST200", "PGRST205", "42P01"}
# PGRST code that means "column not found"
_COL_MISSING_CODES   = {"PGRST204"}

# Cache: set of tables confirmed to exist so we don't re-probe
_exists_cache: set[str] = set()
_missing_cache: set[str] = set()


def _probe_table(sb, table: str) -> bool:
    """Return True if the relation (table or view) exists."""
    if table in _exists_cache:
        return True
    if table in _missing_cache:
        return False
    try:
        sb.table(table).select("*").limit(0).execute()
        _exists_cache.add(table)
        return True
    except Exception as exc:
        msg  = str(exc)
        code = getattr(exc, "code", "") or ""
        if any(c in msg or c in code for c in _TABLE_MISSING_CODES):
            _missing_cache.add(table)
            return False
        # Unexpected error — treat as "table exists but something else failed"
        _exists_cache.add(table)
        return True


def _probe_column(sb, table: str, column: str) -> bool:
    """Return True if the column exists in the given table."""
    try:
        sb.table(table).select(column).limit(0).execute()
        return True
    except Exception as exc:
        msg  = str(exc)
        code = getattr(exc, "code", "") or ""
        # Column-not-found
        if any(c in msg or c in code for c in _COL_MISSING_CODES):
            return False
        # If "PGRST205" / table missing — column obviously doesn't exist either
        if any(c in msg or c in code for c in _TABLE_MISSING_CODES):
            return False
        # Any other error (e.g. RLS deny for views) → column likely exists
        return True


# ─────────────────────────────────────────────────────────────────────────────
# Row-count sanity
# ─────────────────────────────────────────────────────────────────────────────

ROW_COUNT_CHECKS: list[tuple[str, int]] = [
    ("events",          1),
    ("tiktok_accounts", 1),
]


def _row_counts(sb) -> tuple[int, int]:
    passed = failed = 0
    _hdr("Row-count sanity")
    for table, min_rows in ROW_COUNT_CHECKS:
        try:
            res   = sb.table(table).select("id", count="exact").limit(1).execute()
            count = res.count if res.count is not None else len(res.data)
            if count >= min_rows:
                _ok(f"{table}: {count} rows (≥ {min_rows})")
                passed += 1
            else:
                _fail(f"{table}: {count} rows, expected ≥ {min_rows}")
                failed += 1
        except Exception as exc:
            _fail(f"{table}: query error — {exc}")
            failed += 1
    return passed, failed


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def run(verbose: bool = False) -> int:
    url = os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print(f"{_R}ERROR: EXPO_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not in env.{_0}")
        return 1

    try:
        from supabase import create_client
        sb = create_client(url, key)
    except Exception as exc:
        print(f"{_R}ERROR: Supabase client init failed: {exc}{_0}")
        return 1

    print(f"\n{'═' * 60}")
    print(f"  GOZI DB Smoke Test")
    print(f"  {url}")
    print(f"{'═' * 60}")

    total_pass = total_fail = 0
    prev_table = None

    _hdr("Schema checks  (schema.sql  +  schema_v2.sql  +  schema_tiktok.sql)")

    for table, column in ALL_CHECKS:

        if verbose and table != prev_table:
            section = (
                "schema_tiktok" if any(t == table for t, _ in SCHEMA_TIKTOK) else
                "schema.sql"    if any(t == table and table in ("events","user_saved") for t, _ in SCHEMA_BASE) else
                "schema_v2"
            )
            print(f"\n  {_C}[{section}]{_0}  {_B}{table}{_0}")
        prev_table = table

        if column is None:
            exists = _probe_table(sb, table)
            label  = f"TABLE/VIEW  {table}"
            if exists:
                _ok(label)
                total_pass += 1
            else:
                _fail(f"{label}  — NOT FOUND")
                total_fail += 1
        else:
            # Only check column if table exists
            if not _probe_table(sb, table):
                _fail(f"COLUMN  {table}.{column}  — TABLE MISSING")
                total_fail += 1
            else:
                exists = _probe_column(sb, table, column)
                label  = f"COLUMN  {table}.{column}"
                if exists:
                    if verbose:
                        _ok(label)
                    total_pass += 1
                else:
                    _fail(f"{label}  — MISSING")
                    total_fail += 1

    # Row counts
    rc_p, rc_f = _row_counts(sb)
    total_pass += rc_p
    total_fail += rc_f

    # Summary
    print(f"\n{'═' * 60}")
    print(f"  Checks : {total_pass + total_fail}  "
          f"{_G}PASS: {total_pass}{_0}  "
          f"{(_R if total_fail else '')}FAIL: {total_fail}{_0}")

    if total_fail == 0:
        print(f"  {_G}{_B}ALL CHECKS PASSED ✓{_0}")
    else:
        print(f"  {_R}{_B}{total_fail} CHECK(S) FAILED ✗{_0}")

    print(f"{'═' * 60}\n")
    return 0 if total_fail == 0 else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="GOZI DB Smoke Test")
    ap.add_argument("--verbose", "-v", action="store_true",
                    help="Show every column check (not just failures)")
    args = ap.parse_args()
    sys.exit(run(verbose=args.verbose))
