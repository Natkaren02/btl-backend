import { Router } from 'express';
import crypto from 'crypto';

const router = Router();

const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_CERT_ID = process.env.EBAY_CERT_ID;
const EBAY_VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN;
const EBAY_ENDPOINT_URL = 'https://btl-backend-production-f682.up.railway.app/api/ebay/notifications';
const EBAY_BASE = 'https://api.ebay.com/buy/browse/v1';

// eBay account deletion notification endpoint (required for API access)
router.get('/notifications', (req, res) => {
  const challengeCode = req.query.challenge_code;
  if (!challengeCode) return res.status(400).json({ error: 'No challenge code' });

  const hash = crypto.createHash('sha256');
  hash.update(challengeCode);
  hash.update(EBAY_VERIFICATION_TOKEN);
  hash.update(EBAY_ENDPOINT_URL);
  const challengeResponse = hash.digest('hex');

  res.json({ challengeResponse });
});

router.post('/notifications', (req, res) => {
  // Handle account deletion — in production would delete user data
  console.log('eBay account deletion notification received');
  res.status(200).json({ ok: true });
});

// Search eBay fashion listings
router.get('/search', async (req, res) => {
  const { q, limit = 24 } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    const params = new URLSearchParams({
      q: `${q} sustainable organic vintage secondhand`,
      limit: String(limit),
      category_ids: '11450', // eBay Fashion category
      filter: 'conditionIds:{1000|1500|2000|2500|3000}', // New to Good condition
    });

    const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('eBay token error:', tokenData);
      return res.json({ results: [], total: 0 });
    }

    const searchRes = await fetch(`${EBAY_BASE}/item_summary/search?${params}`, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', // closest to Denmark
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    const data = await searchRes.json();
    const items = data.itemSummaries || [];

    const results = items.map(item => ({
      id: `ebay-${item.itemId}`,
      source: 'ebay',
      source_id: item.itemId,
      source_url: item.itemWebUrl,
      title: item.title,
      price: Math.round(parseFloat(item.price?.value || 0) * 750 * 100),
      price_dkk: Math.round(parseFloat(item.price?.value || 0) * 750),
      currency: 'DKK',
      images: item.image?.imageUrl ? [item.image.imageUrl] : [],
      size_label: '',
      category: 'other',
      sustainability_score: 65,
      fibre_data: null,
      fibre_data_source: 'unknown',
      available: true,
      brand: null,
    }));

    res.json({ results, total: results.length });
  } catch (err) {
    console.error('eBay search error:', err.message);
    res.json({ results: [], total: 0 });
  }
});

export default router;
