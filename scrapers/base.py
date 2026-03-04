"""
BaseScraper: every scraper must subclass this and implement fetch().
fetch() must return a list of canonical event dicts (see pipeline/models.py).
"""
import logging
from abc import ABC, abstractmethod
from typing import List

log = logging.getLogger(__name__)


class BaseScraper(ABC):
    source: str = ""  # must set in subclass

    @abstractmethod
    def fetch(self) -> List[dict]:
        """Scrape and return list of canonical event dicts."""
        ...

    def run(self) -> List[dict]:
        log.info(f"[{self.source}] starting...")
        try:
            events = self.fetch()
            log.info(f"[{self.source}] fetched {len(events)} events")
            return events
        except Exception as e:
            log.error(f"[{self.source}] FAILED: {e}", exc_info=True)
            return []
