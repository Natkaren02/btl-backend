"""
Vinted scraper — fetches second-hand listings and inserts into Supabase.

How it works:
  Vinted has no public API. This scraper uses their internal search API
  (the same one their app uses) with proper headers to look like a browser.
  This is a grey area legally — the right long-term move is a partnership
  agreement with Vinted. Use this for the prototype/demo phase.

Run:
  python scrapers/vinted.py --query "dark denim" --max 50
  python scrapers/vinted.py --categories bottoms,tops --max 200

Scheduled via scrapers/scheduler.py
"""

import requests
import json
import time
import argparse
import os
import re
from datetime import datetime
from supabase import create_client, Client
from dataclasses import dataclass, asdict
from typing import Optional

# ── CONFIG ────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

VINTED_BASE = "https://www.vinted.dk/api/v2"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "da-DK,da;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://www.vinted.dk/",
    "X-Requested-With": "XMLHttpRequest",
}

# Category mapping: our categories → Vinted catalog IDs
CATEGORY_MAP = {
    "tops":       [1904, 1903, 4],      # T-shirts, shirts, tops
    "bottoms":    [1914, 1905, 6],      # Jeans, trousers, skirts
    "dresses":    [1903, 8],
    "outerwear":  [1919, 1918, 5],      # Coats, jackets
    "shoes":      [16],
    "accessories":[18, 19],
}

@dataclass
class VintedListing:
    source: str = "vinted"
    source_id: str = ""
    source_url: str = ""
    title: str = ""
    description: str = ""
    price: int = 0          # in øre (DKK cents)
    currency: str = "DKK"
    images: list = None
    size_label: str = ""
    size_eu: str = ""
    category: str = ""
    brand_name: str = ""    # raw brand from listing — not linked to brands table
    available: bool = True
    last_seen_at: str = ""


def get_vinted_auth_token():
    """
    Vinted requires a session cookie/token to make API requests.
    This hits the homepage first to get the cookie.
    """
    session = requests.Session()
    session.get("https://www.vinted.dk", headers=HEADERS, timeout=10)
    return session


def search_vinted(session, query: str, category_ids: list = None, page: int = 1, per_page: int = 48) -> dict:
    """Call Vinted's internal search API."""
    params = {
        "search_text": query,
        "page": page,
        "per_page": per_page,
        "order": "newest_first",
        "currency": "DKK",
    }
    if category_ids:
        params["catalog[]"] = category_ids

    try:
        resp = session.get(
            f"{VINTED_BASE}/items",
            params=params,
            headers=HEADERS,
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Vinted search error: {e}")
        return {}


def parse_listing(item: dict) -> Optional[VintedListing]:
    """Parse a raw Vinted API item into our data structure."""
    try:
        # Extract price in øre (Vinted gives price_numeric as float)
        price_dkk = float(item.get("price_numeric", 0))
        price_ore = int(price_dkk * 100)

        # Extract images
        photos = item.get("photos", [])
        images = [p.get("url", "") for p in photos if p.get("url")]

        # Extract size
        size_label = item.get("size_title", "") or ""
        size_eu = extract_eu_size(size_label)

        # Map Vinted category to our categories
        catalog_id = item.get("catalog_id")
        category = map_category(catalog_id)

        # Build source URL
        item_id = str(item.get("id", ""))
        url_title = re.sub(r"[^a-z0-9]+", "-", item.get("title", "").lower()).strip("-")
        source_url = f"https://www.vinted.dk/vetements/{url_title}-{item_id}"

        return VintedListing(
            source_id=item_id,
            source_url=source_url,
            title=item.get("title", ""),
            description=item.get("description", ""),
            price=price_ore,
            images=images[:4],  # max 4 images
            size_label=size_label,
            size_eu=size_eu,
            category=category,
            brand_name=item.get("brand_title", "") or "",
            available=item.get("is_for_swap", True),
            last_seen_at=datetime.utcnow().isoformat(),
        )
    except Exception as e:
        print(f"Parse error for item {item.get('id')}: {e}")
        return None


def extract_eu_size(size_label: str) -> str:
    """Try to extract a numeric EU size from a size string."""
    if not size_label:
        return ""
    # Match patterns like "38", "EU 38", "38/40", "XS (34)"
    match = re.search(r"\b(3[0-9]|4[0-9]|[XS|S|M|L|XL]+)\b", size_label)
    return match.group(1) if match else ""


def map_category(catalog_id: Optional[int]) -> str:
    """Map Vinted catalog ID to our category system."""
    if not catalog_id:
        return "other"
    for category, ids in CATEGORY_MAP.items():
        if catalog_id in ids:
            return category
    return "other"


def upsert_listings(listings: list[VintedListing]) -> int:
    """Insert or update listings in Supabase. Returns count of upserted items."""
    if not listings:
        return 0

    rows = []
    for listing in listings:
        d = asdict(listing)
        d["images"] = d.get("images") or []
        rows.append(d)

    try:
        result = supabase.table("products").upsert(
            rows,
            on_conflict="source,source_id",
            ignore_duplicates=False,
        ).execute()
        return len(result.data or [])
    except Exception as e:
        print(f"Upsert error: {e}")
        return 0


def scrape(query: str, max_results: int = 100, category: str = None):
    """Main scrape function."""
    print(f"Scraping Vinted: query='{query}', max={max_results}, category={category}")

    session = get_vinted_auth_token()
    category_ids = CATEGORY_MAP.get(category) if category else None

    all_listings = []
    page = 1
    per_page = 48

    while len(all_listings) < max_results:
        data = search_vinted(session, query, category_ids, page, per_page)

        items = data.get("items", [])
        if not items:
            print(f"No more results at page {page}")
            break

        for item in items:
            listing = parse_listing(item)
            if listing:
                all_listings.append(listing)

        total_pages = data.get("pagination", {}).get("total_pages", 1)
        print(f"Page {page}/{total_pages} — {len(all_listings)} listings so far")

        if page >= total_pages:
            break

        page += 1
        time.sleep(1.5)  # be polite — don't hammer the server

    # Upsert to Supabase
    count = upsert_listings(all_listings[:max_results])
    print(f"Done — {count} listings upserted to Supabase")
    return count


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Vinted scraper for BeyondTheLabel")
    parser.add_argument("--query", default="", help="Search query")
    parser.add_argument("--category", help="Category filter (tops, bottoms, dresses, outerwear, shoes)")
    parser.add_argument("--max", type=int, default=100, help="Max results to fetch")
    args = parser.parse_args()

    scrape(args.query, args.max, args.category)
