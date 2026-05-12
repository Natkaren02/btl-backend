import { Router } from 'express';
import crypto from 'crypto';

const router = Router();

const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_CERT_ID = process.env.EBAY_CERT_ID;
const EBAY_VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN;
const EBAY_ENDPOINT_URL = 'https://btl-backend-production-f682.up.railway.app/api/ebay/notifications';
const EBAY_BASE = 'https://api.ebay.com/buy/browse/v1';

router.get('/notifications', (req, res) => {
  const challengeCode = req.query.challenge_code;
  if (!challengeCode) return res.status(400).json({ error: 'No challenge code' });
  const hash = crypto.createHash('sha256');
  hash.update(challengeCode);
  hash.update(EBAY_VERIFICATION_TOKEN);
  hash.update(EBAY_ENDPOINT_URL);
  res.json({ challengeResponse: hash.digest('hex') });
});

router.post('/notifications', (req, res) => {
  console.log('eBay account deletion notification received');
  res.status(200).json({ ok: true });
});

let cachedToken = null;
let tokenExpiry = 0;

async function getEbayToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  
  const credentials = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64');
  const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  });
  const data = await tokenRes.json();
  if (data.error) {
    console.error('eBay token error:', data.error_description);
    return null;
  }
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// Precise category IDs for women's fashion on eBay
const CATEGORY_MAP = {
  'dress': '63861',
  'kjole': '63861',
  'jeans': '11554',
  'coat': '63862',
  'frakke': '63862',
  'jacket': '63862',
  'jakke': '63862',
  'blazer': '63862',
  'trousers': '57988',
  'bukser': '57988',
  'skirt': '63864',
  'nederdel': '63864',
  'top': '53159',
  'blouse': '53159',
  'bluse': '53159',
  'sweater': '63852',
  'cardigan': '63852',
  'boots': '45333',
  'støvler': '45333',
  'shoes': '45333',
  'sko': '45333',
  'bag': '169291',
  'taske': '169291',
};

function getCategoryId(query) {
  const q = query.toLowerCase();
  for (const [keyword, catId] of Object.entries(CATEGORY_MAP)) {
    if (q.includes(keyword)) return catId;
  }
  return '15724'; // Women's clothing general
}

async function searchEbay(q, limit = 48, marketplace = 'EBAY_DE') {
  const token = await getEbayToken();
  if (!token) return [];

  const categoryId = getCategoryId(q);

  const params = new URLSearchParams({
    q,
    limit: String(limit),
    category_ids: categoryId,
    sort: 'bestMatch',
    filter: 'itemLocationCountry:DE|itemLocationCountry:NL|itemLocationCountry:BE|itemLocationCountry:FR|itemLocationCountry:SE|itemLocationCountry:NO',
  });

  const res = await fetch(`${EBAY_BASE}/item_summary/search?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplace,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    console.error('eBay search failed:', res.status);
    return [];
  }

  const data = await res.json();
  return data.itemSummaries || [];
}

function formatItem(item) {
  const priceValue = parseFloat(item.price?.value || 0);
  const priceCurrency = item.price?.currency || 'EUR';
  // Convert to DKK
  const toDKK = priceCurrency === 'GBP' ? 8.8 : priceCurrency === 'USD' ? 6.8 : 7.46;
  const priceDKK = Math.round(priceValue * toDKK);

  return {
    id: `ebay-${item.itemId}`,
    source: 'ebay',
    source_id: item.itemId,
    source_url: item.itemWebUrl,
    title: item.title,
    price: priceDKK * 100,
    price_dkk: priceDKK,
    currency: 'DKK',
    images: item.image?.imageUrl ? [item.image.imageUrl] : [],
    size_label: '',
    category: 'other',
    sustainability_score: 62,
    fibre_data: null,
    fibre_data_source: 'unknown',
    available: true,
    brand: null,
  };
}

router.get('/search', async (req, res) => {
  const { q, limit = 48 } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    const items = await searchEbay(q, parseInt(limit));
    const results = items.filter(i => i.image?.imageUrl).map(formatItem);
    console.log(`eBay search "${q}": ${results.length} results with images`);
    res.json({ results, total: results.length });
  } catch (err) {
    console.error('eBay search error:', err.message);
    res.json({ results: [], total: 0 });
  }
});

router.post('/match', async (req, res) => {
  const { search_terms } = req.body;
  if (!search_terms?.length) return res.status(400).json({ error: 'search_terms required' });

  try {
    const allResults = [];
    const seenIds = new Set();

    for (const term of search_terms.slice(0, 3)) {
      const items = await searchEbay(term, 16);
      for (const item of items) {
        if (!seenIds.has(item.itemId) && item.image?.imageUrl) {
          seenIds.add(item.itemId);
          allResults.push(formatItem(item));
        }
      }
    }

    res.json({ results: allResults });
  } catch (err) {
    console.error('eBay match error:', err.message);
    res.json({ results: [] });
  }
});

export default router;
