"""
GOZI — Master Scraper Orchestrator
Rulează toate scraperele în secvență și raportează totalul.

Usage:
  cd scrapers
  pip install -r requirements.txt
  cp .env.example .env  # completează keys
  python run_all.py
"""

import time

def run_scraper(name, scrape_fn, push_fn):
    print(f"\n{'='*55}")
    print(f"  {name}")
    print(f"{'='*55}")
    try:
        events = scrape_fn()
        print(f"  → {len(events)} events scraped")
        if events:
            push_fn(events)
        return len(events)
    except Exception as e:
        print(f"  ❌ Error in {name}: {e}")
        return 0

if __name__ == "__main__":
    total = 0
    start = time.time()

    try:
        from ra_scraper import scrape_ra, push_to_supabase as ra_push
        total += run_scraper("RA.co — Bucharest Clubs", scrape_ra, ra_push)
        time.sleep(2)
    except Exception as e:
        print(f"⚠ ra_scraper import error: {e}")

    try:
        from hardpedia_scraper import scrape_hardpedia, push_to_supabase as hp_push
        total += run_scraper("Hardpedia.ro", scrape_hardpedia, hp_push)
        time.sleep(2)
    except Exception as e:
        print(f"⚠ hardpedia_scraper import error: {e}")

    try:
        from iabilet_scraper import scrape_iabilet, push_to_supabase as ia_push
        total += run_scraper("iabilet.ro", scrape_iabilet, ia_push)
        time.sleep(2)
    except Exception as e:
        print(f"⚠ iabilet_scraper import error: {e}")

    try:
        from zilesinopti_scraper import scrape_zilesinopti, push_to_supabase as zn_push
        total += run_scraper("ZilesiNopti.ro", scrape_zilesinopti, zn_push)
    except Exception as e:
        print(f"⚠ zilesinopti_scraper import error: {e}")

    elapsed = round(time.time() - start, 1)
    print(f"\n{'='*55}")
    print(f"  ✅ DONE — {total} events total in {elapsed}s")
    print(f"{'='*55}\n")
