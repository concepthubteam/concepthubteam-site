"""
GOZI — TikTok Ingestion Scheduler (Cron)
=========================================

Decides WHICH TikTok accounts to refresh right now and runs ingestion
with cost controls, backoff, retries, and observability.

USAGE:
    # Refresh all due accounts (up to 20, cap 10 videos each)
    python -m pipeline.tiktok_cron --limit 20 --max-videos 10

    # Refresh a single specific account
    python -m pipeline.tiktok_cron --account controlclub --max-videos 5

    # Dry-run (no DB writes, no Apify calls)
    python -m pipeline.tiktok_cron --dry-run

    # Alert if >= 3 failures
    python -m pipeline.tiktok_cron --alert-on-failures 3

SELECTION LOGIC:
    1. is_active = true
    2. last_checked_at IS NULL  →  run now (never checked)
    3. (now() - last_checked_at) >= refresh_interval_minutes  →  run now
    4. Order: never-checked first, then most-stale

COST CONTROLS:
    --limit N         max accounts per cron run
    --max-videos N    max videos to process per account (passed to collector)

BACKOFF:
    If an account had 2 consecutive failures in tiktok_runs in the last 24h,
    skip it for 12 more hours.

RELIABILITY:
    - Retry collector once on transient errors (before marking as failed)
    - Sleep 2–5s jitter between accounts (rate limiting)
    - Timeout context for per-account work

OBSERVABILITY:
    - Insert to tiktok_runs per account (started_at, finished_at, status, ...)
    - Print summary at the end
    - Write cron_failed.log if failures >= --alert-on-failures

TIMEZONE:
    All datetime computations use Europe/Bucharest.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# Timezone helper
# ─────────────────────────────────────────────────────────────────────────────

try:
    from zoneinfo import ZoneInfo  # Python 3.9+
    TZ_BUCHAREST = ZoneInfo("Europe/Bucharest")
except ImportError:
    # Fallback for Python 3.8
    try:
        import pytz
        TZ_BUCHAREST = pytz.timezone("Europe/Bucharest")
    except ImportError:
        TZ_BUCHAREST = timezone(timedelta(hours=2))  # EET fallback


def now_bucharest() -> datetime:
    """Current datetime in Europe/Bucharest timezone."""
    return datetime.now(tz=TZ_BUCHAREST)


def parse_iso_tz(iso: str) -> datetime:
    """Parse ISO 8601 string → timezone-aware datetime (Bucharest)."""
    if not iso:
        return None
    # Handle Postgres timestamps: "2024-01-15 10:30:00+00", "2024-01-15T10:30:00Z"
    iso = iso.replace("Z", "+00:00").replace(" ", "T")
    # Normalize "+HH" or "-HH" offset (no colon) → "+HH:00" for Python 3.9 compat
    # Postgres outputs "+00" or "+02"; Python 3.9 fromisoformat requires "+HH:MM"
    iso = re.sub(r'([+-]\d{2})$', r'\1:00', iso)
    try:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(TZ_BUCHAREST)
    except (ValueError, TypeError):
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("tiktok_cron")


# ─────────────────────────────────────────────────────────────────────────────
# Result dataclass
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class AccountResult:
    username: str
    account_id: Optional[int] = None
    ok: bool = False
    skipped: bool = False
    skip_reason: str = ""
    videos_fetched: int = 0
    videos_new: int = 0
    signals_created: int = 0
    elapsed: float = 0.0
    error: str = ""
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


# ─────────────────────────────────────────────────────────────────────────────
# Supabase helper
# ─────────────────────────────────────────────────────────────────────────────

def _get_supabase():
    try:
        from supabase import create_client
        url = os.getenv("EXPO_PUBLIC_SUPABASE_URL", "")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        if not url or not key:
            raise EnvironmentError(
                "Missing EXPO_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"
            )
        return create_client(url, key)
    except ImportError:
        log.error("supabase-py not installed. Run: pip install supabase")
        sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# Account selection
# ─────────────────────────────────────────────────────────────────────────────

def _interval_minutes(row: dict) -> int:
    """Return refresh interval in minutes. Supports both schema versions."""
    # Schema v2: refresh_interval_minutes (INTEGER)
    v = row.get("refresh_interval_minutes")
    if v:
        return int(v)
    # Schema v1: refresh_interval_h (INTEGER hours)
    h = row.get("refresh_interval_h")
    if h:
        return int(h) * 60
    return 24 * 60  # default: once per day


def _select_due_accounts(sb, limit: int, account_filter: Optional[str]) -> List[dict]:
    """
    Load active accounts from DB, filter to those whose refresh interval
    has elapsed, ordered by priority (never-checked first, then most stale).

    Supports both schema versions:
      v2: is_active BOOLEAN, refresh_interval_minutes INTEGER
      v1: status TEXT ('active'/'paused'), refresh_interval_h INTEGER
    """
    _COLS = "id, username, refresh_interval_minutes, refresh_interval_h, last_checked_at"
    rows: List[dict] = []

    # ── Try v2 schema: is_active BOOLEAN ─────────────────────────────────────
    try:
        q = sb.table("tiktok_accounts").select(_COLS).eq("is_active", True)
        if account_filter:
            q = q.eq("username", account_filter)
        rows = (q.limit(500).execute()).data or []
    except Exception as e_v2:
        # ── Fallback to v1 schema: status TEXT ───────────────────────────────
        log.debug("is_active query failed (%s), falling back to status='active'", e_v2)
        try:
            q = sb.table("tiktok_accounts").select(_COLS).eq("status", "active")
            if account_filter:
                q = q.eq("username", account_filter)
            rows = (q.limit(500).execute()).data or []
        except Exception as e_v1:
            log.error("Failed to load accounts from Supabase: %s", e_v1)
            return []

    now = now_bucharest()
    due: List[dict] = []

    for row in rows:
        last_str = row.get("last_checked_at")

        if last_str is None:
            row["_staleness_s"] = float("inf")
            due.append(row)
            continue

        last_dt = parse_iso_tz(last_str)
        if last_dt is None:
            row["_staleness_s"] = float("inf")
            due.append(row)
            continue

        elapsed_s  = (now - last_dt).total_seconds()
        required_s = _interval_minutes(row) * 60  # minutes → seconds

        if elapsed_s >= required_s:
            row["_staleness_s"] = elapsed_s
            due.append(row)

    # Sort: most stale first (inf = never checked → first)
    due.sort(key=lambda r: r["_staleness_s"], reverse=True)

    log.info(
        "Account selection: %d active in DB → %d due now → taking up to %d",
        len(rows), len(due), limit,
    )
    return due[:limit]


# ─────────────────────────────────────────────────────────────────────────────
# Backoff check
# ─────────────────────────────────────────────────────────────────────────────

BACKOFF_CONSECUTIVE_FAILURES = 2    # skip if >= this many consecutive failures
BACKOFF_WINDOW_H = 24               # look-back window in hours
BACKOFF_SKIP_H = 12                 # skip duration in hours


def _should_backoff(sb, account_id: int) -> tuple[bool, str]:
    """
    Check if the account had BACKOFF_CONSECUTIVE_FAILURES consecutive failures
    in the last BACKOFF_WINDOW_H hours.

    Returns (should_skip: bool, reason: str)
    """
    try:
        cutoff = (now_bucharest() - timedelta(hours=BACKOFF_WINDOW_H)).isoformat()
        resp = (
            sb.table("tiktok_runs")
            .select("status, finished_at")
            .eq("account_id", account_id)
            .gte("finished_at", cutoff)
            .order("finished_at", desc=True)
            .limit(BACKOFF_CONSECUTIVE_FAILURES + 2)
            .execute()
        )
        rows = resp.data or []

        if len(rows) < BACKOFF_CONSECUTIVE_FAILURES:
            return False, ""

        # Check the most recent N runs are all failures
        # Schema status values: 'success' | 'error' | 'partial'
        recent = rows[:BACKOFF_CONSECUTIVE_FAILURES]
        if all(r.get("status") == "error" for r in recent):
            # Check the most recent failure time — skip if within BACKOFF_SKIP_H
            latest_failure = parse_iso_tz(recent[0].get("finished_at") or "")
            if latest_failure:
                skip_until = latest_failure + timedelta(hours=BACKOFF_SKIP_H)
                now = now_bucharest()
                if now < skip_until:
                    reason = (
                        f"{BACKOFF_CONSECUTIVE_FAILURES} consecutive failures; "
                        f"skip until {skip_until.strftime('%H:%M')}"
                    )
                    return True, reason

        return False, ""
    except Exception as exc:
        log.warning("Backoff check failed for account %d: %s — not skipping", account_id, exc)
        return False, ""


# ─────────────────────────────────────────────────────────────────────────────
# Run logging
# ─────────────────────────────────────────────────────────────────────────────

def _log_run_to_db(sb, result: AccountResult):
    """Insert a tiktok_runs row for this account result."""
    if sb is None:
        return
    try:
        # Map cron status → schema status: 'success' | 'error' | 'partial'
        if result.ok:
            db_status = "success"
        elif result.skipped:
            db_status = "partial"    # skipped = partial run, not a real error
        else:
            db_status = "error"

        row = {
            "account_id":       result.account_id,
            "account_username": result.username,
            "status":           db_status,
            "videos_fetched":   result.videos_fetched,
            "videos_new":       result.videos_new,
            "signals_new":      result.signals_created,
            "error_msg":        result.error or None,
            "duration_s":       round(result.elapsed, 2),
            "started_at":       result.started_at.isoformat() if result.started_at else None,
            "finished_at":      result.finished_at.isoformat() if result.finished_at else None,
        }
        sb.table("tiktok_runs").insert(row).execute()
    except Exception as exc:
        log.debug("Could not write tiktok_runs row: %s", exc)


# ─────────────────────────────────────────────────────────────────────────────
# Single-account runner with retry
# ─────────────────────────────────────────────────────────────────────────────

MAX_RETRIES = 1  # retry once on transient error

# Errors that are worth retrying (network / timeout / rate-limit)
_TRANSIENT_ERRORS = (
    "timeout", "timed out", "connection", "reset", "temporarily",
    "rate limit", "429", "503", "502", "unavailable",
)


def _is_transient(error_str: str) -> bool:
    low = error_str.lower()
    return any(t in low for t in _TRANSIENT_ERRORS)


def _run_account(
    ingest,
    username: str,
    account_id: Optional[int],
    max_videos: int,
    dry_run: bool,
) -> AccountResult:
    """
    Run ingest for one account with up to MAX_RETRIES on transient failures.
    """
    result = AccountResult(
        username=username,
        account_id=account_id,
        started_at=now_bucharest(),
    )
    t0 = time.perf_counter()

    for attempt in range(MAX_RETRIES + 1):
        try:
            stats = ingest.ingest_account(username, max_videos=max_videos)
            result.elapsed = time.perf_counter() - t0
            result.finished_at = now_bucharest()

            if stats.get("error"):
                err = str(stats["error"])
                if attempt < MAX_RETRIES and _is_transient(err):
                    log.warning(
                        "  @%s: transient error '%s' — retrying (attempt %d/%d)...",
                        username, err, attempt + 1, MAX_RETRIES + 1,
                    )
                    time.sleep(3)
                    continue
                result.error = err
                result.ok = False
            else:
                result.ok = True
                result.videos_fetched  = stats.get("videos_fetched", 0)
                result.videos_new      = stats.get("videos_new", 0)
                result.signals_created = stats.get("signals_new", 0)
                result.account_id      = stats.get("account_id") or account_id

            return result

        except Exception as exc:
            err = str(exc)
            result.elapsed = time.perf_counter() - t0
            result.finished_at = now_bucharest()

            if attempt < MAX_RETRIES and _is_transient(err):
                log.warning(
                    "  @%s: exception '%s' — retrying...", username, err
                )
                time.sleep(3)
                continue

            result.error = err
            result.ok = False
            log.error("  @%s: FAILED after %d attempts: %s", username, attempt + 1, err)
            return result

    # Should not reach here, but be safe
    result.ok = False
    result.elapsed = time.perf_counter() - t0
    result.finished_at = now_bucharest()
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Alert helper
# ─────────────────────────────────────────────────────────────────────────────

ALERT_LOG_PATH = Path(__file__).parent.parent / "cron_failed.log"


def _write_failure_alert(results: List[AccountResult], failures: int, threshold: int):
    """
    Print a big warning and write cron_failed.log if failures >= threshold.
    """
    msg_lines = [
        "=" * 60,
        f"  ⚠️  CRON ALERT: {failures} failures >= threshold {threshold}",
        "=" * 60,
        f"  Time: {now_bucharest().isoformat()}",
        "  Failed accounts:",
    ]
    for r in results:
        if not r.ok and not r.skipped:
            msg_lines.append(f"    • @{r.username}: {r.error[:80]}")
    msg_lines.append("=" * 60)
    alert_text = "\n".join(msg_lines) + "\n"

    # Print to console
    for line in msg_lines:
        log.warning(line)

    # Write to local log file
    try:
        with ALERT_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(alert_text)
        log.warning("  Alert written to: %s", ALERT_LOG_PATH)
    except OSError as exc:
        log.error("Could not write alert log: %s", exc)


# ─────────────────────────────────────────────────────────────────────────────
# Main cron runner
# ─────────────────────────────────────────────────────────────────────────────

def run_cron(
    limit: int = 20,
    max_videos: int = 10,
    account_filter: Optional[str] = None,
    dry_run: bool = False,
    alert_on_failures: int = 5,
) -> dict:
    """
    Main entry point (callable directly from other modules or CLI).

    Returns summary dict.
    """
    cron_start = time.perf_counter()
    log.info("═" * 60)
    log.info("  GOZI TikTok Cron  —  %s", now_bucharest().strftime("%Y-%m-%d %H:%M:%S %Z"))
    log.info("  limit=%d  max_videos=%d  dry_run=%s", limit, max_videos, dry_run)
    log.info("═" * 60)

    # ── Supabase client ───────────────────────────────────────────────────────
    sb = None if dry_run else _get_supabase()

    # ── TikTokIngest instance ─────────────────────────────────────────────────
    from pipeline.tiktok_ingest import TikTokIngest
    # log_runs=False: cron owns tiktok_runs inserts (includes started_at + account_username).
    # Without this, TikTokIngest._log_run would also insert a row → duplicate entries.
    ingest = TikTokIngest(
        supabase=sb,
        dry_run=dry_run,
        log_runs=False,
    )

    # ── Select due accounts ───────────────────────────────────────────────────
    if account_filter:
        # Single-account mode: load just that one
        log.info("Single-account mode: @%s", account_filter)
        if dry_run:
            accounts = [{"id": None, "username": account_filter,
                         "refresh_interval_minutes": 60, "last_checked_at": None}]
        else:
            accounts = _select_due_accounts(sb, limit=1, account_filter=account_filter)
        if not accounts:
            log.warning("Account @%s not found or not active in DB", account_filter)
            # Still run in case it's a new account not yet in DB
            accounts = [{"id": None, "username": account_filter,
                         "refresh_interval_minutes": 60, "last_checked_at": None}]
    else:
        if dry_run:
            log.info("[DRY-RUN] Skipping DB account selection; no accounts loaded")
            accounts = []
        else:
            accounts = _select_due_accounts(sb, limit=limit, account_filter=None)

    if not accounts:
        log.info("No accounts due for refresh. Cron done.")
        return {
            "accounts_due": 0,
            "accounts_processed": 0,
            "successes": 0,
            "failures": 0,
            "skipped": 0,
            "total_videos": 0,
            "total_signals": 0,
            "elapsed_s": round(time.perf_counter() - cron_start, 2),
        }

    # ── Process accounts ──────────────────────────────────────────────────────
    results: List[AccountResult] = []

    for idx, account in enumerate(accounts):
        username   = account.get("username", "")
        account_id = account.get("id")

        log.info("─" * 60)
        log.info("[%d/%d] @%s", idx + 1, len(accounts), username)

        # Backoff check
        if account_id and not dry_run:
            skip, reason = _should_backoff(sb, account_id)
            if skip:
                log.info("  Skipping @%s: %s", username, reason)
                results.append(AccountResult(
                    username=username,
                    account_id=account_id,
                    skipped=True,
                    skip_reason=reason,
                    started_at=now_bucharest(),
                    finished_at=now_bucharest(),
                ))
                continue

        # Run ingest
        result = _run_account(
            ingest=ingest,
            username=username,
            account_id=account_id,
            max_videos=max_videos,
            dry_run=dry_run,
        )
        results.append(result)

        # Write run log to DB
        if not dry_run and not result.skipped:
            _log_run_to_db(sb, result)

        # Status log
        if result.ok:
            log.info(
                "  ✓ @%s  videos=%d (+%d new)  signals=%d  %.1fs",
                username, result.videos_fetched, result.videos_new,
                result.signals_created, result.elapsed,
            )
        elif result.skipped:
            log.info("  ⏭  @%s  skipped: %s", username, result.skip_reason)
        else:
            log.error("  ✗ @%s  FAILED: %s", username, result.error)

        # Rate limiting — jitter sleep between accounts (not after last one)
        if idx < len(accounts) - 1:
            sleep_s = random.uniform(2.0, 5.0)
            log.debug("  Rate-limit sleep %.1fs...", sleep_s)
            time.sleep(sleep_s)

    # ── Summary ───────────────────────────────────────────────────────────────
    successes = sum(1 for r in results if r.ok)
    failures  = sum(1 for r in results if not r.ok and not r.skipped)
    skipped   = sum(1 for r in results if r.skipped)
    total_videos  = sum(r.videos_fetched for r in results)
    total_signals = sum(r.signals_created for r in results)
    elapsed = round(time.perf_counter() - cron_start, 2)

    summary = {
        "accounts_due":       len(accounts),
        "accounts_processed": len(results),
        "successes":          successes,
        "failures":           failures,
        "skipped":            skipped,
        "total_videos":       total_videos,
        "total_signals":      total_signals,
        "elapsed_s":          elapsed,
        "dry_run":            dry_run,
    }

    print()
    print("═" * 60)
    print("  GOZI TikTok Cron — Summary")
    print("─" * 60)
    for r in results:
        if r.ok:
            icon = "✓"
            detail = f"videos={r.videos_fetched}(+{r.videos_new})  signals={r.signals_created}  {r.elapsed:.1f}s"
        elif r.skipped:
            icon = "⏭"
            detail = f"skipped: {r.skip_reason}"
        else:
            icon = "✗"
            detail = f"FAILED: {r.error[:60]}"
        print(f"  {icon}  @{r.username:30s}  {detail}")
    print("─" * 60)
    print(
        f"  Processed: {len(results)} | ✓ {successes}  ✗ {failures}  ⏭ {skipped} | "
        f"Videos: {total_videos} | Signals: {total_signals} | {elapsed}s"
    )
    print("═" * 60)

    # Alert if failures exceed threshold
    if failures >= alert_on_failures:
        _write_failure_alert(results, failures, alert_on_failures)

    return summary


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="tiktok_cron",
        description="GOZI TikTok Ingestion Scheduler — refreshes due accounts",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--limit", type=int, default=20,
        help="Max accounts to process per cron run (default: 20)",
    )
    p.add_argument(
        "--max-videos", type=int, default=10,
        help="Max videos to process per account (default: 10)",
    )
    p.add_argument(
        "--account", type=str, default=None,
        help="Run for a specific account only (e.g. --account controlclub)",
    )
    p.add_argument(
        "--dry-run", action="store_true",
        help="Parse and print; no DB writes, no Apify calls",
    )
    p.add_argument(
        "--alert-on-failures", type=int, default=5, metavar="N",
        help="Print alert and write cron_failed.log if failures >= N (default: 5)",
    )
    p.add_argument(
        "--verbose", "-v", action="store_true",
        help="Enable DEBUG logging",
    )
    return p


def main():
    parser = _build_parser()
    args = parser.parse_args()

    if args.verbose:
        log.setLevel(logging.DEBUG)
        logging.getLogger("pipeline").setLevel(logging.DEBUG)
        logging.getLogger("scrapers").setLevel(logging.DEBUG)

    summary = run_cron(
        limit=args.limit,
        max_videos=args.max_videos,
        account_filter=args.account,
        dry_run=args.dry_run,
        alert_on_failures=args.alert_on_failures,
    )

    # Exit code: 1 if any hard failures
    sys.exit(0 if summary["failures"] == 0 else 1)


if __name__ == "__main__":
    main()
