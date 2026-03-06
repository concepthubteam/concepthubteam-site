"""
GOZI Scraper — IESIM.ro Bucharest
Uses Playwright (headless Chromium) to render the Next.js App Router page
and extract events from the hydrated DOM.

Site architecture (2026-03): Next.js with React Server Components + Suspense.
Events are NOT in the raw HTTP response — they render client-side via RSC hydration.
No REST API is exposed from the browser. Playwright is the only reliable approach.

Image URL pattern: .../images/{venue_slug}/small/{event_slug}_{YYYY-MM-DD}.webp
→ date is embedded in the image filename.
"""

import logging
import re
from typing import List, Optional

from scrapers.base import BaseScraper
from pipeline.normalize import map_category

log = logging.getLogger(__name__)

BASE_URL = "https://www.iesim.ro"
LIST_URL = f"{BASE_URL}/evenimente-bucuresti"

# JS snippet injected into the page to extract all event cards from the DOM.
# NOTE: Python processes \n → newline BEFORE passing to JS.
# Fix: use RegExp constructors (not /regex/ literals) for all patterns.
_EXTRACT_JS = """() => {
    const seen    = new Set();
    const results = [];

    // RegExp objects — avoids Python string-escape issues with \\n in regex literals
    const reId    = new RegExp('-(\\\\d+)$');
    const reTime  = new RegExp('(\\\\d{2}:\\\\d{2})');
    const reVenue = new RegExp('\\\\d{2}:\\\\d{2}\\\\s*[\\u2022\\u00b7]\\\\s*(.+)');
    const rePureNum = new RegExp('^\\\\d+$');

    // Romanian months → zero-padded month number
    const MONTHS = {
        'ianuarie':'01','februarie':'02','martie':'03','aprilie':'04',
        'mai':'05','iunie':'06','iulie':'07','august':'08',
        'septembrie':'09','octombrie':'10','noiembrie':'11','decembrie':'12'
    };

    // Status badges and date-like lines to skip when looking for the title
    const SKIP_LINES = new Set([
        'azi','maine','mâine','ieri',
        'început','sold out','complet','vândut','epuizat','anulat','cancelled',
        'bilete','info','detalii',
    ]);

    function isSkipLine(line) {
        const l = line.toLowerCase().trim();
        if (rePureNum.test(l)) return true;               // pure number (day)
        if (l.length <= 3) return true;                   // too short
        if (SKIP_LINES.has(l)) return true;               // known skip word
        for (const m of Object.keys(MONTHS)) { if (l.startsWith(m)) return true; }
        if (l.includes('\u2022') || l.includes('\u00b7')) return true; // venue line
        return false;
    }

    function dateFromLines(deduped) {
        let day = null, month = null;
        for (const line of deduped) {
            const l = line.toLowerCase().trim();
            if (rePureNum.test(l)) { day = l.padStart(2, '0'); continue; }
            for (const [m, num] of Object.entries(MONTHS)) {
                if (l.startsWith(m)) { month = num; break; }
            }
        }
        if (day && month) {
            const yr = new Date().getFullYear();
            return yr + '-' + month + '-' + day;
        }
        return null;
    }

    document.querySelectorAll('li.w-full').forEach(card => {
        const link = card.querySelector('a[href*="/event/"]');
        if (!link) return;
        const href = link.getAttribute('href');
        if (seen.has(href)) return;
        seen.add(href);

        // Numeric event ID from URL tail: /event/some-slug-209889
        const idMatch = href.match(reId);
        const eventId = idMatch ? idMatch[1] : null;

        // De-duplicate lines: RSC hydration renders title twice consecutively
        const allText = card.innerText || '';
        const lines = allText.split('\\n').map(l => l.trim()).filter(l => l.length > 0);
        const deduped = [];
        for (const l of lines) {
            if (deduped.length === 0 || deduped[deduped.length - 1] !== l) {
                deduped.push(l);
            }
        }

        // Title = first non-skip line (skip dates, status badges, venue lines)
        const title = deduped.find(l => !isSkipLine(l)) || deduped[0] || '';

        // Time + venue: "18:00 • Teatrul Bulandra, Sala Toma Caragiu"
        const venueM = allText.match(reVenue);
        const timeM  = allText.match(reTime);

        // Date from card header text (day + month lines); fallback = image URL in Python
        const dateText = dateFromLines(deduped);

        // Image src (contains ISO date in filename for Supabase images)
        const img    = card.querySelector('img');
        const imgSrc = img ? (img.getAttribute('src') || '') : '';

        results.push({
            id:       eventId,
            title:    title.substring(0, 200),
            time:     timeM  ? timeM[1]                          : null,
            venue:    venueM ? venueM[1].trim().substring(0, 120): null,
            dateText,
            href,
            imgSrc,
        });
    });
    return results;
}"""


def _date_from_image(img_src: str) -> Optional[str]:
    """Extract ISO date string from Supabase image URL filename."""
    m = re.search(r'_(\d{4}-\d{2}-\d{2})\.webp', img_src or "")
    return m.group(1) if m else None


class IesimScraper(BaseScraper):
    source = "iesim"

    def __init__(self, max_pages: int = 5):
        self.max_pages = max_pages   # reserved for future multi-page support

    # ──────────────────────────────────────────────────────────────────────────
    def fetch(self) -> List[dict]:
        try:
            from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
        except ImportError:
            log.error(
                "playwright not installed — run: "
                "pip install playwright && playwright install chromium"
            )
            return []

        raw: list = []
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                locale="ro-RO",
            )
            try:
                log.info(f"  Navigating to {LIST_URL}...")
                page.goto(LIST_URL, timeout=30_000, wait_until="domcontentloaded")

                # Wait until real event cards (with /event/ links) appear
                page.wait_for_selector(
                    'li.w-full a[href*="/event/"]',
                    timeout=25_000,
                )
                log.info("  Events loaded — extracting from DOM...")
                raw = page.evaluate(_EXTRACT_JS)
            except PWTimeout:
                log.warning("  Timeout waiting for iesim.ro events (slow server)")
            except Exception as e:
                log.error(f"  Playwright error: {e}")
            finally:
                browser.close()

        log.info(f"  Raw DOM events: {len(raw)}")
        return [self._to_canonical(e) for e in raw if e.get("title")]

    # ──────────────────────────────────────────────────────────────────────────
    def _to_canonical(self, e: dict) -> dict:
        href       = e.get("href", "")
        source_url = f"{BASE_URL}{href}" if href.startswith("/") else href
        event_id   = e.get("id") or str(abs(hash(href)))

        title      = (e.get("title") or "").strip()
        venue_name = (e.get("venue") or "București").strip()
        img_src    = e.get("imgSrc", "")
        start_at   = _date_from_image(img_src) or e.get("dateText")
        category   = map_category(title)

        images = (
            [img_src]
            if img_src and img_src.startswith("http") and "placeholder" not in img_src
            else []
        )

        return {
            "source":          "iesim",
            "source_event_id": f"iesim_{event_id}",
            "url":             source_url,
            "title":           title[:200],
            "description":     None,
            "category":        category,
            "start_at":        start_at,
            "end_at":          None,
            "time_display":    e.get("time"),
            "venue": {
                "name":            venue_name[:120],
                "address":         f"{venue_name}, București",
                "lat":             None,
                "lng":             None,
                "google_place_id": None,
            },
            "price":      {"min": None, "max": None, "currency": "RON"},
            "is_free":    False,
            "ticket_url": source_url,
            "images":     images,
            "tags":       [],
        }


# ──────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    import json, sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    evs = IesimScraper().run()
    print(f"\nTotal: {len(evs)}")
    if evs:
        print(json.dumps(evs[0], indent=2, ensure_ascii=False))
