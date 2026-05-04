"""
CLIP visual matching — powers the Pinterest style import feature.

How it works:
  1. User connects their Pinterest board URL
  2. We fetch the board's public images
  3. We run each image through CLIP to get a 512-dim embedding vector
  4. We find the most visually similar products in our database
     using cosine similarity (pgvector in Supabase)
  5. We return ranked results — most visually similar first

Why this beats text matching:
  CLIP encodes the VISUAL properties of an image (silhouette, colour,
  texture, proportions) into a vector. Similarity is measured between
  vectors, not between words. A low-rise wide-leg jean photo matches
  other low-rise wide-leg jean photos, not high-waisted trousers.

Requirements:
  pip install torch torchvision transformers pillow requests supabase

Usage:
  python clip.py --board-url "https://pinterest.com/username/board" --top 20
  python clip.py --image-url "https://..." --top 12
"""

import torch
import requests
import json
import os
import argparse
import re
from io import BytesIO
from PIL import Image
from transformers import CLIPProcessor, CLIPModel
from supabase import create_client

# ── SETUP ─────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Load CLIP model (downloads ~600MB on first run, cached after)
# Using ViT-B/32 — good balance of speed and accuracy
print("Loading CLIP model...")
model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
model.eval()

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
model = model.to(DEVICE)
print(f"CLIP loaded on {DEVICE}")


def embed_image(image: Image.Image) -> list[float]:
    """Convert a PIL image to a CLIP embedding vector (512 dimensions)."""
    inputs = processor(images=image, return_tensors="pt").to(DEVICE)
    with torch.no_grad():
        features = model.get_image_features(**inputs)
        # Normalise to unit length for cosine similarity
        features = features / features.norm(dim=-1, keepdim=True)
    return features.cpu().squeeze().tolist()


def embed_image_url(url: str) -> list[float] | None:
    """Download an image from URL and embed it."""
    try:
        resp = requests.get(url, timeout=10, headers={
            "User-Agent": "BeyondTheLabel/1.0"
        })
        resp.raise_for_status()
        image = Image.open(BytesIO(resp.content)).convert("RGB")
        return embed_image(image)
    except Exception as e:
        print(f"Failed to embed {url}: {e}")
        return None


def fetch_pinterest_images(board_url: str) -> list[str]:
    """
    Fetch image URLs from a public Pinterest board.

    Pinterest's API requires OAuth for most endpoints.
    This uses their public board RSS/JSON feed where available.
    For production, use Pinterest API with proper OAuth.

    Returns list of image URLs from the board.
    """
    # Clean the URL
    board_url = board_url.rstrip("/")

    # Try the Pinterest JSON endpoint (works for public boards)
    json_url = f"{board_url}.json"
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; BeyondTheLabel/1.0)"
    }

    try:
        resp = requests.get(json_url, headers=headers, timeout=15)
        data = resp.json()

        # Extract image URLs from pins
        pins = data.get("resourceDataCache", {})
        images = []

        for key, value in pins.items():
            if isinstance(value, dict):
                for pin in value.get("data", {}).get("pins", []):
                    img = pin.get("images", {}).get("orig", {}).get("url")
                    if img:
                        images.append(img)

        if images:
            print(f"Found {len(images)} images from Pinterest board")
            return images[:50]  # max 50 pins

    except Exception:
        pass

    # Fallback: scrape the board HTML for og:image tags
    try:
        resp = requests.get(board_url, headers=headers, timeout=15)
        # Extract image URLs using regex
        images = re.findall(r'"orig":\{"url":"([^"]+)"', resp.text)
        if images:
            print(f"Found {len(images)} images via HTML scraping")
            return list(set(images))[:50]
    except Exception as e:
        print(f"Pinterest fetch failed: {e}")

    return []


def find_similar_products(embedding: list[float], limit: int = 20, category: str = None) -> list[dict]:
    """
    Find products with similar visual embeddings using pgvector.
    Requires the match_products RPC function in Supabase.
    """
    try:
        params = {
            "query_embedding": embedding,
            "match_threshold": 0.72,  # cosine similarity threshold
            "match_count": limit,
        }
        if category:
            params["filter_category"] = category

        result = supabase.rpc("match_products", params).execute()
        return result.data or []
    except Exception as e:
        print(f"Vector search error: {e}")
        return []


def process_pinterest_board(board_url: str, user_id: str = None, top_k: int = 20) -> dict:
    """
    Full pipeline: Pinterest board URL → visually similar products.
    Returns aggregated results across all pins.
    """
    print(f"Processing Pinterest board: {board_url}")

    # 1. Fetch images
    image_urls = fetch_pinterest_images(board_url)
    if not image_urls:
        return {"error": "Could not fetch images from Pinterest board. Check the board is public.", "results": []}

    # 2. Embed each image
    embeddings = []
    for url in image_urls[:20]:  # limit to 20 pins for speed
        emb = embed_image_url(url)
        if emb:
            embeddings.append(emb)

    if not embeddings:
        return {"error": "Could not process any images", "results": []}

    # 3. Average the embeddings to get a "style fingerprint"
    # This captures the overall aesthetic of the board
    import numpy as np
    avg_embedding = np.mean(embeddings, axis=0).tolist()

    # Normalise
    norm = np.linalg.norm(avg_embedding)
    if norm > 0:
        avg_embedding = (np.array(avg_embedding) / norm).tolist()

    # 4. Find similar products
    results = find_similar_products(avg_embedding, limit=top_k)

    # 5. Optionally save the embedding to user profile
    if user_id and avg_embedding:
        supabase.table("users").update({
            "pinterest_board_url": board_url,
            "pinterest_synced_at": "now()",
        }).eq("id", user_id).execute()

    print(f"Found {len(results)} visually similar products")
    return {
        "pins_processed": len(embeddings),
        "results": results,
    }


def embed_all_products():
    """
    Generate CLIP embeddings for all products in the database.
    Run this once after initial scraping, then incrementally for new products.
    This is the setup step that powers the visual search.
    """
    print("Embedding all products with CLIP...")

    # Fetch products without embeddings (process in batches)
    batch_size = 50
    offset = 0
    total = 0

    while True:
        result = supabase.table("products")\
            .select("id, images")\
            .is_("clip_embedding", "null")\
            .range(offset, offset + batch_size - 1)\
            .execute()

        products = result.data or []
        if not products:
            break

        for product in products:
            images = product.get("images") or []
            if not images:
                continue

            # Use first image
            emb = embed_image_url(images[0])
            if emb:
                supabase.table("products")\
                    .update({"clip_embedding": emb})\
                    .eq("id", product["id"])\
                    .execute()
                total += 1

        print(f"Embedded {total} products so far...")
        offset += batch_size

    print(f"Done — {total} products embedded")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CLIP visual matching for BeyondTheLabel")
    parser.add_argument("--board-url", help="Pinterest board URL")
    parser.add_argument("--image-url", help="Single image URL to match against")
    parser.add_argument("--top", type=int, default=20, help="Number of results")
    parser.add_argument("--embed-all", action="store_true", help="Embed all products (run once)")
    args = parser.parse_args()

    if args.embed_all:
        embed_all_products()
    elif args.board_url:
        results = process_pinterest_board(args.board_url, top_k=args.top)
        print(json.dumps(results, indent=2))
    elif args.image_url:
        emb = embed_image_url(args.image_url)
        if emb:
            results = find_similar_products(emb, limit=args.top)
            print(json.dumps(results, indent=2))
