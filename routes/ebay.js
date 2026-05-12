import { Router } from 'express';
import crypto from 'crypto';

const router = Router();

const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_CERT_ID = process.env.EBAY_CERT_ID;
const EBAY_VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN;
const EBAY_ENDPOINT_URL = 'https://btl-backend-production-f682.up.railway.app/api/ebay/notifications';
const EBAY_BASE = 'https://api.ebay.com/buy/browse/v1';

// eBay account deletion notification endpoint
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

async function getEbayToken() {
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
  return data.access_token;
}

// Category mapping for better eBay searches
const CATEGORY_MAP = {
  'dress': '63861',      // Women's Dresses
  'jeans': '11554',      // Jeans
  'coat': '63862',       // Coats & Jackets
  'jacket': '63862',
  'trousers': '57988',   // Trousers
  'skirt': '63864',      // Skirts
  'top': '53159',        // Tops
  'blouse': '53159',
  'shoes': '3034',       // Women's Shoes
  'boots': '3034',
  'bag': '169291',       // Handbags
  'sweater': '63852',    // Knitwear
  'cardigan': '63852',
};

function getCategoryId(query) {
  const q = query.toLowerCase();
  for (const [keyword, catId] of Object.entries(CATEGORY_MAP)) {
    if (q.includes(keyword)) return catId;
  }
  return '11450'; // General fashion
}

router.get('/search', async (req, res) => {
  const { q, limit = 24 } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    const token = await getEbayToken();
    if (!token) return res.json({ results: [], total: 0 });

    const categoryId = getCategoryId(q);
    
    const params = new URLSearchParams({
      q: q, // Use exact query without adding extra words
      limit: String(Math.min(parseInt(limit), 50)),
      category_ids: categoryId,
      sort: 'bestMatch',
    });

    const searchRes = await fetch(`${EBAY_BASE}/item_summary/search?${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    const data = await searchRes.json();
    const items = data.itemSummaries || [];
    console.log(`eBay search "${q}" in cat ${categoryId}: ${items.length} results`);

    const results = items
      .filter(item => item.image?.imageUrl) // only items with images
      .map(item => {
        const priceGBP = parseFloat(item.price?.value || 0);
        const priceDKK = Math.round(priceGBP * 8.5); // GBP to DKK
        return {
          id: `ebay-${item.itemId}`,
          source: 'ebay',
          source_id: item.itemId,
          source_url: item.itemWebUrl,
          title: item.title,
          price: priceDKK * 100,
          price_dkk: priceDKK,
          currency: 'DKK',
          images: [item.image.imageUrl],
          size_label: item.itemGroupHref ? '' : '',
          category: 'other',
          sustainability_score: 62,
          fibre_data: null,
          fibre_data_source: 'unknown',
          available: true,
          brand: null,
        };
      });

    res.json({ results, total: results.length });
  } catch (err) {
    console.error('eBay search error:', err.message);
    res.json({ results: [], total: 0 });
  }
});

export default router;
