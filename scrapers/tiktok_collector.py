"""
GOZI — TikTok Collector (Apify)
Fetches profile + recent videos for a list of TikTok accounts.

Providers supported:
  - Apify  (default): uses `clockworks/tiktok-scraper` actor
  - Stub   (testing): returns deterministic fake data

Usage:
  collector = TikTokCollector()
  result = collector.collect_account("controlclub.ro")
  # => {"profile": {...}, "videos": [...]}

  batch = collector.collect_batch(["controlclub.ro", "quantic_bucharest"])
  # => {username: result_dict, ...}

Env vars:
  APIFY_API_TOKEN  — required for Apify provider
"""

import logging
import os
import time
from typing import Optional

import requests

log = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

APIFY_BASE = "https://api.apify.com/v2"
APIFY_ACTOR = "clockworks~tiktok-scraper"  # maintained TikTok scraper actor

INTER_REQUEST_DELAY = 2.0   # seconds between accounts
MAX_VIDEOS_PER_ACCOUNT = 20


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _normalize_username(username: str) -> str:
    """Strip @ prefix and trailing whitespace."""
    return username.strip().lstrip("@")


def _tiktok_url(username: str) -> str:
    return f"https://www.tiktok.com/@{_normalize_username(username)}"


# ─────────────────────────────────────────────────────────────────────────────
# TikTokCollector
# ─────────────────────────────────────────────────────────────────────────────

class TikTokCollector:
    """
    Collects TikTok profile + video data via Apify.

    Falls back to stub mode if APIFY_API_TOKEN is not set
    (useful for unit tests / local dev without paid API).
    """

    def __init__(
        self,
        apify_token:    Optional[str] = None,
        max_videos:     int   = MAX_VIDEOS_PER_ACCOUNT,
        request_delay:  float = INTER_REQUEST_DELAY,
        timeout:        int   = 120,
    ):
        self.token       = apify_token or os.getenv("APIFY_API_TOKEN", "")
        self.max_videos  = max_videos
        self.delay       = request_delay
        self.timeout     = timeout
        self._stub_mode  = not bool(self.token)

        if self._stub_mode:
            log.warning("APIFY_API_TOKEN not set — running in stub mode (fake data).")

    # ── Apify API helpers ─────────────────────────────────────────────────────

    def _apify_headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    def _run_actor(self, usernames: list[str]) -> Optional[list]:
        """
        Run the Apify TikTok scraper actor synchronously.
        Returns a list of raw result objects or None on error.
        """
        input_payload = {
            "profiles": [_tiktok_url(u) for u in usernames],
            "resultsPerPage": self.max_videos,
            "shouldDownloadVideos": False,
            "shouldDownloadCovers": False,
        }

        log.info(f"Starting Apify actor for {len(usernames)} accounts…")
        try:
            # Start run
            r = requests.post(
                f"{APIFY_BASE}/acts/{APIFY_ACTOR}/run-sync-get-dataset-items",
                headers=self._apify_headers(),
                json=input_payload,
                timeout=self.timeout,
                params={"timeout": 90, "memory": 512},
            )
            if r.status_code not in (200, 201):
                log.error(f"Apify actor error {r.status_code}: {r.text[:300]}")
                return None
            return r.json()
        except requests.exceptions.Timeout:
            log.error("Apify actor timed out.")
            return None
        except Exception as e:
            log.error(f"Apify request error: {e}")
            return None

    # ── Stub mode (no API token) ──────────────────────────────────────────────

    @staticmethod
    def _stub_result(username: str) -> dict:
        return {
            "profile": {
                "username": username,
                "display_name": username.replace(".", " ").title(),
                "bio": "Club / venue in Bucharest 🎶",
                "avatar_url": None,
                "followers": 5000,
                "following": 200,
                "likes_total": 50000,
                "url": _tiktok_url(username),
            },
            "videos": [
                {
                    "video_url": f"https://www.tiktok.com/@{username}/video/stub{i}",
                    "tiktok_id": f"stub{i}",
                    "caption": f"Event la {username} — 15 martie ora 22:00 🎵 #techno #bucharest #control",
                    "hashtags": ["#techno", "#bucharest", "#control"],
                    "thumbnail_url": None,
                    "posted_at": "2026-03-01T20:00:00Z",
                    "views": 10000 + i * 500,
                    "likes": 1200 + i * 50,
                    "comments": 80 + i * 5,
                    "shares": 200 + i * 10,
                    "raw_json": {},
                }
                for i in range(3)
            ],
        }

    # ── Parse Apify response ──────────────────────────────────────────────────

    @staticmethod
    def _parse_apify_item(item: dict) -> dict:
        """
        Map one Apify TikTok scraper result to our internal format.
        Handles both profile-level items and video-level items.
        """
        # Profile data (may be on profile-level item or embedded in video)
        author = item.get("authorMeta") or item.get("author") or {}
        profile = {
            "username":     author.get("name") or author.get("uniqueId") or "",
            "display_name": author.get("nickName") or author.get("nickname") or "",
            "bio":          author.get("signature") or "",
            "avatar_url":   author.get("avatar") or author.get("avatarMedium") or "",
            "followers":    author.get("fans") or author.get("followerCount") or 0,
            "following":    author.get("following") or author.get("followingCount") or 0,
            "likes_total":  author.get("heart") or author.get("heartCount") or 0,
            "url":          _tiktok_url(author.get("name") or ""),
        }

        # Video data
        hashtags = []
        text = item.get("text") or item.get("desc") or ""
        # Extract #hashtags from caption
        import re
        hashtags = re.findall(r"#\w+", text)

        video = {
            "video_url":     item.get("webVideoUrl") or item.get("video", {}).get("playAddr") or "",
            "tiktok_id":     str(item.get("id") or ""),
            "caption":       text,
            "hashtags":      hashtags,
            "thumbnail_url": item.get("covers", [None])[0] if item.get("covers") else
                             (item.get("video", {}).get("cover") or ""),
            "posted_at":     None,
            "views":         item.get("playCount") or item.get("stats", {}).get("playCount") or 0,
            "likes":         item.get("diggCount") or item.get("stats", {}).get("diggCount") or 0,
            "comments":      item.get("commentCount") or item.get("stats", {}).get("commentCount") or 0,
            "shares":        item.get("shareCount") or item.get("stats", {}).get("shareCount") or 0,
            "raw_json":      item,
        }

        # Parse posted_at
        ts = item.get("createTime") or item.get("createTimeISO")
        if ts:
            try:
                if isinstance(ts, (int, float)):
                    import datetime
                    video["posted_at"] = datetime.datetime.utcfromtimestamp(ts).isoformat() + "Z"
                else:
                    video["posted_at"] = str(ts)
            except Exception:
                pass

        return {"profile": profile, "video": video}

    # ── Public API ────────────────────────────────────────────────────────────

    def collect_account(self, username: str) -> dict:
        """
        Collect profile + recent videos for a single account.
        Returns {"profile": {...}, "videos": [...]}
        """
        username = _normalize_username(username)

        if self._stub_mode:
            return self._stub_result(username)

        raw = self._run_actor([username])
        if not raw:
            return {"profile": {"username": username}, "videos": [], "error": "fetch_failed"}

        profile = {}
        videos  = []
        for item in raw:
            parsed = self._parse_apify_item(item)
            if not profile:
                profile = parsed["profile"]
            if parsed["video"].get("tiktok_id"):
                videos.append(parsed["video"])

        log.info(f"  @{username}: {len(videos)} videos fetched")
        return {"profile": profile or {"username": username}, "videos": videos}

    def collect_batch(self, usernames: list[str]) -> dict:
        """
        Collect data for multiple accounts.
        Returns {username: result_dict, ...}
        """
        results = {}
        for i, username in enumerate(usernames, 1):
            log.info(f"[{i}/{len(usernames)}] @{username}")
            try:
                results[username] = self.collect_account(username)
            except Exception as e:
                log.error(f"Error collecting @{username}: {e}")
                results[username] = {"profile": {"username": username}, "videos": [], "error": str(e)}

            if i < len(usernames):
                time.sleep(self.delay)

        return results


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

    ap = argparse.ArgumentParser(description="GOZI TikTok Collector")
    ap.add_argument("usernames", nargs="+", help="TikTok usernames (without @)")
    ap.add_argument("--max-videos", type=int, default=MAX_VIDEOS_PER_ACCOUNT)
    args = ap.parse_args()

    collector = TikTokCollector(max_videos=args.max_videos)
    batch = collector.collect_batch(args.usernames)
    print(json.dumps(batch, indent=2, default=str))
