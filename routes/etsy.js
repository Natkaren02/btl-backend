import { Router } from 'express';
import { supabase } from '../lib/supabase.js';

const router = Router();
const ETSY_API_KEY = process.env.ETSY_API_KEY;
const ETSY_BASE = 'https://api.etsy.com/v3/application';

// Sustainable fashion keywords to filter Etsy results
const SUSTAINABLE_KEYWORDS = [
  'organic', 'sustainable', 'recycled', 'upcycled', 'vintage', 'secondhand',
  'second hand', 'linen', 'hemp', 'natural', 'eco', 'ethical', 'handmade',
  'slow fashion', 'deadstock', 'repurposed', 'zero waste', 'fair trade',
  'wool', 'cashmere', 'silk', 'cotton', 'leather', 'tencel', 'lyocell'
];

function isSustainable(listing) {
  const text = `${listing.title} ${listing.description || ''} ${(listing.tags || []).join(' ')}`.toLowerCase();
  return SUSTAINABLE_KEYWORDS.some(kw => text.includes(kw));
}

function scoreEtsyListing(listing) {
  const text = `${listing.title} ${listing.description || ''} ${(listing.tags || []).join(' ')}`.toLowerCase();
  let score = 45; // base for handmade/small brand

  if (text.includes('organic')) score += 15;
  if (text.includes('sustainable') || text.includes('eco')) score += 12;
  if (text.includes('recycled') || text.includes('upcycled') || text.includes('repurposed')) score += 15;
  if (text.includes('vintage') || text.includes('secondhand')) score += 10;
  if (text.includes('linen') || text.includes('hemp')) score += 12;
  if (text.includes('handmade') || text.includes('hand made')) score += 8;
  if (text.includes('fair trade')) score += 10;
  if (text.includes('deadstock')) score += 10;
  if (text.includes('natural dye') || text.includes('plant dye')) score += 10;
  if (text.includes('small batch')) score += 8;

  return Math.min(100, score);
}

async function searchEtsy(query, limit = 24) {
  if (!ETSY_API_KEY) {
    console.error('ETSY_API_KEY not set');
    return [];
  }

  try {
    const params = new URLSearchParams({
      keywords: query,
      limit: String(limit),
      includes: 'Images,Shop',
      sort_on: 'score',
      sort_order: 'desc',
      taxonomy_id: '1', // Fashion category
    });

    const res = await fetch(`${ETSY_BASE}/listings/active?${params}`, {
      headers: {
        'x-api-key': ETSY_API_KEY,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.error(`Etsy API error: ${res.status} ${await res.text()}`);
      return [];
    }

    const data = await res.json();
    return data.results || [];
  } catch (err) {
    console.error('Etsy search error:', err.message);
    return [];
  }
}

function formatListing(listing) {
  const image = listing.images?.[0];
  const imageUrl = image?.url_570xN || image?.url_fullxfull || null;
  const priceAmount = listing.price?.amount || 0;
  const priceDivisor = listing.price?.divisor || 100;
  const priceDKK = Math.round((priceAmount / priceDivisor) * 750); // approximate EUR to DKK

  return {
    id: `etsy-${listing.listing_id}`,
    source: 'etsy',
    source_id: String(listing.listing_id),
    source_url: listing.url,
    title: listing.title,
    description: (listing.description || '').substring(0, 300),
    price: priceDKK * 100, // in øre
    price_dkk: priceDKK,
    currency: 'DKK',
    images: imageUrl ? [imageUrl] : [],
    size_label: '',
    category: 'other',
    sustainability_score: scoreEtsyListing(listing),
    fibre_data: null,
    fibre_data_source: 'unknown',
    available: true,
    brand: listing.shop ? { name: listing.shop.shop_name, verified: false } : null,
  };
}

// Search Etsy listings
router.get('/search', async (req, res) => {
  const { q, limit = 24 } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    // Add sustainable keywords to boost relevant results
    const enhancedQuery = `${q} sustainable organic handmade`;
    const listings = await searchEtsy(enhancedQuery, parseInt(limit));

    // Filter to only sustainable items
    const sustainable = listings.filter(isSustainable);
    const formatted = sustainable.map(formatListing);

    console.log(`Etsy search "${q}": ${listings.length} results, ${formatted.length} sustainable`);
    res.json({ results: formatted, total: formatted.length });
  } catch (err) {
    console.error('Etsy search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Search Etsy by style terms from Pinterest analysis
router.post('/match', async (req, res) => {
  const { search_terms } = req.body;
  if (!search_terms?.length) return res.status(400).json({ error: 'search_terms required' });

  try {
    const allResults = [];
    const seenIds = new Set();

    for (const term of search_terms.slice(0, 4)) {
      const listings = await searchEtsy(`${term} sustainable handmade`, 12);
      for (const listing of listings) {
        if (!seenIds.has(listing.listing_id) && isSustainable(listing)) {
          seenIds.add(listing.listing_id);
          allResults.push(formatListing(listing));
        }
      }
    }

    console.log(`Etsy Pinterest match: ${allResults.length} results`);
    res.json({ results: allResults });
  } catch (err) {
    console.error('Etsy match error:', err);
    res.status(500).json({ error: 'Match failed' });
  }
});

export default router;
