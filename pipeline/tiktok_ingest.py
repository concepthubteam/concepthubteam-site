"""
GOZI — TikTok Ingest Pipeline
Upserts TikTok accounts + videos into Supabase and runs signal extraction.

Flow:
  1. collect_account(username) via TikTokCollector
  2. upsert account profile → tiktok_accounts
  3. upsert videos          → tiktok_videos (dedup by video_url)
  4. run SignalExtractor on unprocessed videos
  5. upsert signals         → signals table
  6. log run stats          → tiktok_runs

Usage:
  python -m pipeline.tiktok_ingest controlclub.ro quantic_bucharest

  # From Python:
  from pipeline.tiktok_ingest import TikTokIngest
  ingest = TikTokIngest()
  stats = ingest.run(["controlclub.ro", "quantic_bucharest"])
"""

import logging
import os
import time
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Supabase helper
# ─────────────────────────────────────────────────────────────────────────────

def _get_supabase():
    from supabase import create_client
    url = os.getenv("EXPO_PUBLIC_SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise EnvironmentError("EXPO_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
    return create_client(url, key)


# ─────────────────────────────────────────────────────────────────────────────
# TikTokIngest
# ─────────────────────────────────────────────────────────────────────────────

class TikTokIngest:
    """
    Orchestrates TikTok collection → DB ingest → signal extraction.
    """

    def __init__(
        self,
        supabase=None,
        collector=None,
        extractor=None,
        dry_run: bool = False,
        log_runs: bool = True,
    ):
        self._sb         = supabase
        self._collector  = collector
        self._extractor  = extractor
        self.dry_run     = dry_run
        self.log_runs    = log_runs   # set False when cron handles tiktok_runs itself

    # ── Lazy init ─────────────────────────────────────────────────────────────

    @property
    def sb(self):
        if self._sb is None:
            self._sb = _get_supabase()
        return self._sb

    @property
    def collector(self):
        if self._collector is None:
            from scrapers.tiktok_collector import TikTokCollector
            self._collector = TikTokCollector()
        return self._collector

    @property
    def extractor(self):
        if self._extractor is None:
            from pipeline.signal_extractor import SignalExtractor
            self._extractor = SignalExtractor()
            # Optionally load venue list from DB for better recall
            try:
                self._extractor.load_venues_from_db(self.sb)
            except Exception:
                pass
        return self._extractor

    # ── DB helpers ────────────────────────────────────────────────────────────

    def _upsert_account(self, profile: dict) -> Optional[int]:
        """Upsert account, return DB id."""
        username = (profile.get("username") or "").strip()
        if not username:
            return None

        row = {
            "username":     username,
            "url":          profile.get("url") or f"https://www.tiktok.com/@{username}",
            "display_name": profile.get("display_name") or "",
            "bio":          profile.get("bio") or "",
            "avatar_url":   profile.get("avatar_url") or "",
            "followers":    int(profile.get("followers") or 0),
            "following":    int(profile.get("following") or 0),
            "likes_total":  int(profile.get("likes_total") or 0),
            "last_checked_at": "now()",
        }

        if self.dry_run:
            log.info(f"[DRY] Would upsert account @{username}")
            return -1

        try:
            resp = self.sb.table("tiktok_accounts").upsert(
                row,
                on_conflict="username",
            ).execute()
            data = resp.data
            if data:
                return data[0].get("id")
        except Exception as e:
            log.warning(f"Could not upsert account @{username}: {e}")
        return None

    def _upsert_video(self, account_id: int, video: dict) -> Optional[int]:
        """Upsert video, return DB id. Returns None if already exists."""
        video_url = (video.get("video_url") or "").strip()
        if not video_url:
            return None

        row = {
            "account_id":    account_id,
            "video_url":     video_url,
            "tiktok_id":     video.get("tiktok_id") or "",
            "caption":       video.get("caption") or "",
            "hashtags":      video.get("hashtags") or [],
            "thumbnail_url": video.get("thumbnail_url") or "",
            "posted_at":     video.get("posted_at"),
            "views":         int(video.get("views") or 0),
            "likes":         int(video.get("likes") or 0),
            "comments":      int(video.get("comments") or 0),
            "shares":        int(video.get("shares") or 0),
            "raw_json":      video.get("raw_json") or {},
            "processed":     False,
        }
        # Remove None posted_at
        if not row["posted_at"]:
            del row["posted_at"]

        if self.dry_run:
            log.debug(f"[DRY] Would upsert video {video_url[:60]}")
            return -1

        try:
            resp = self.sb.table("tiktok_videos").upsert(
                row,
                on_conflict="video_url",
                ignore_duplicates=True,
            ).execute()
            data = resp.data
            if data:
                return data[0].get("id")
        except Exception as e:
            log.warning(f"Could not upsert video {video_url[:60]}: {e}")
        return None

    def _upsert_signals(self, video_id: int, signals: list):
        """Batch upsert signals for a video."""
        if not signals or self.dry_run:
            return
        rows = [
            {
                "video_id":   video_id,
                "type":       s["type"],
                "value":      s["value"],
                "confidence": float(s.get("confidence", 0.5)),
            }
            for s in signals
        ]
        try:
            self.sb.table("signals").upsert(rows).execute()
        except Exception as e:
            log.warning(f"Could not upsert signals for video {video_id}: {e}")

    def _mark_processed(self, video_id: int):
        if self.dry_run:
            return
        try:
            self.sb.table("tiktok_videos").update(
                {"processed": True}
            ).eq("id", video_id).execute()
        except Exception as e:
            log.debug(f"Could not mark video {video_id} processed: {e}")

    def _log_run(self, account_id: Optional[int], status: str, stats: dict,
                 error_msg: str = "", duration_s: float = 0.0):
        if self.dry_run or not self.log_runs:
            return
        row = {
            "account_id":    account_id,
            "status":        status,
            "videos_fetched": stats.get("videos_fetched", 0),
            "videos_new":    stats.get("videos_new", 0),
            "signals_new":   stats.get("signals_new", 0),
            "error_msg":     error_msg or None,
            "duration_s":    round(duration_s, 2),
            "finished_at":   "now()",
        }
        try:
            self.sb.table("tiktok_runs").insert(row).execute()
        except Exception as e:
            log.debug(f"Could not log run: {e}")

    # ── Main methods ──────────────────────────────────────────────────────────

    def ingest_account(self, username: str, max_videos: int = 0) -> dict:
        """
        Full pipeline for one TikTok account.
        Args:
            username:   TikTok username (without @)
            max_videos: If > 0, cap the number of videos processed (cost control)
        Returns stats dict including 'account_id' key.
        """
        t0    = time.time()
        stats = {"videos_fetched": 0, "videos_new": 0, "signals_new": 0, "account_id": None}

        log.info(f"▶  @{username}")

        # 1. Collect
        try:
            result = self.collector.collect_account(username)
        except Exception as e:
            log.error(f"Collect error for @{username}: {e}")
            return {**stats, "error": str(e)}

        if result.get("error"):
            log.warning(f"  @{username}: {result['error']}")
            return {**stats, "error": result["error"]}

        profile = result.get("profile") or {}
        videos  = result.get("videos") or []
        stats["videos_fetched"] = len(videos)

        # Apply max_videos cap (cost control from cron)
        if max_videos and max_videos > 0:
            videos = videos[:max_videos]

        # 2. Upsert account
        account_id = self._upsert_account(profile)
        if account_id is None:
            return {**stats, "error": "account_upsert_failed"}

        stats["account_id"] = account_id

        # 3. Upsert videos + extract signals
        for video in videos:
            vid_id = self._upsert_video(account_id, video)
            if vid_id is None:
                continue  # duplicate or error
            if vid_id > 0:
                stats["videos_new"] += 1

            # 4. Extract signals
            if vid_id and vid_id > 0:
                signals = self.extractor.extract(
                    video.get("caption") or "",
                    video.get("hashtags") or [],
                )
                if signals:
                    self._upsert_signals(vid_id, signals)
                    stats["signals_new"] += len(signals)
                self._mark_processed(vid_id)

        duration = time.time() - t0
        log.info(
            f"  @{username}: {stats['videos_fetched']} fetched, "
            f"{stats['videos_new']} new, {stats['signals_new']} signals "
            f"({duration:.1f}s)"
        )

        # 5. Log run
        self._log_run(
            account_id if account_id and account_id > 0 else None,
            status="success",
            stats=stats,
            duration_s=duration,
        )

        return stats

    def run(self, usernames: list[str]) -> dict:
        """
        Run ingest for a list of TikTok usernames.
        Returns aggregate stats.
        """
        total = {
            "accounts":      len(usernames),
            "videos_fetched": 0,
            "videos_new":    0,
            "signals_new":   0,
            "errors":        0,
        }

        for i, username in enumerate(usernames, 1):
            log.info(f"[{i}/{len(usernames)}] Processing @{username}")
            try:
                stats = self.ingest_account(username)
                if stats.get("error"):
                    total["errors"] += 1
                else:
                    total["videos_fetched"] += stats.get("videos_fetched", 0)
                    total["videos_new"]     += stats.get("videos_new", 0)
                    total["signals_new"]    += stats.get("signals_new", 0)
            except Exception as e:
                log.error(f"Error processing @{username}: {e}", exc_info=True)
                total["errors"] += 1

        log.info(f"TikTok ingest done: {total}")
        return total

    def load_accounts_from_db(self, limit: int = 200, due_only: bool = True) -> list:
        """Load active accounts from tiktok_accounts table.
        Schema: status TEXT ('active'/'paused'/'blocked'), refresh_interval_h INTEGER
        Returns list of dicts with: id, username, refresh_interval_h, last_checked_at
        """
        try:
            q = (
                self.sb.table("tiktok_accounts")
                .select("id, username, refresh_interval_h, last_checked_at")
                .eq("status", "active")     # matches schema column `status TEXT`
            )
            resp = q.limit(limit).execute()
            return resp.data or []
        except Exception as e:
            log.error(f"Could not load accounts from DB: {e}")
            return []


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    import json

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )

    ap = argparse.ArgumentParser(description="GOZI TikTok Ingest")
    ap.add_argument("usernames", nargs="*", help="TikTok usernames (without @)")
    ap.add_argument("--from-db",  action="store_true", help="Load usernames from tiktok_accounts table")
    ap.add_argument("--dry-run",  action="store_true", help="No DB writes")
    ap.add_argument("--limit",    type=int, default=50, help="Max accounts from DB")
    args = ap.parse_args()

    ingest = TikTokIngest(dry_run=args.dry_run)

    usernames = list(args.usernames)  # copy; may be augmented from DB
    if args.from_db:
        rows = ingest.load_accounts_from_db(limit=args.limit)
        usernames = [r["username"] for r in rows if r.get("username")]
        log.info(f"Loaded {len(usernames)} accounts from DB")

    if not usernames:
        ap.print_help()
        import sys; sys.exit(1)

    stats = ingest.run(usernames)
    print(f"\n{'='*50}")
    print(json.dumps(stats, indent=2))
