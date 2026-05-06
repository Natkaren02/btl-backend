import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
 
const router = Router();
 
const PINTEREST_APP_ID = process.env.PINTEREST_APP_ID;
const PINTEREST_APP_SECRET = process.env.PINTEREST_APP_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://sparkly-longma-38df56.netlify.app';
const BACKEND_URL = 'https://btl-backend-production-f682.up.railway.app';
const REDIRECT_URI = `${BACKEND_URL}/api/pinterest/callback`;
 
// Simple in-memory session store
const tokenStore = new Map();
 
// Step 1 — redirect to Pinterest login
router.get('/auth', (req, res) => {
  const params = new URLSearchParams({
    client_id: PINTEREST_APP_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'boards:read,pins:read',
    state: req.query.user_id || 'anonymous',
  });
  res.redirect(`https://www.pinterest.com/oauth/?${params}`);
});
 
// Step 2 — Pinterest redirects back with code
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${FRONTEND_URL}/search?pinterest=error`);
 
  try {
    const tokenRes = await fetch('https://api.pinterest.com/v5/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${PINTEREST_APP_ID}:${PINTEREST_APP_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
 
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('Token error:', tokenData);
      return res.redirect(`${FRONTEND_URL}/search?pinterest=error`);
    }
 
    // Store token with a short session key
    const sessionKey = Math.random().toString(36).substring(2, 12);
    tokenStore.set(sessionKey, {
      token: tokenData.access_token,
      created: Date.now(),
    });
 
    // Redirect with just the short session key — no boards in URL
    res.redirect(`${FRONTEND_URL}/search?pinterest=success&session=${sessionKey}`);
 
  } catch (err) {
    console.error('Callback error:', err);
    res.redirect(`${FRONTEND_URL}/search?pinterest=error`);
  }
});
 
// Step 3 — get boards using session key
router.get('/boards/:sessionKey', async (req, res) => {
  const session = tokenStore.get(req.params.sessionKey);
  if (!session) return res.status(404).json({ error: 'Session expired' });
 
  try {
    const boardsRes = await fetch('https://api.pinterest.com/v5/boards?page_size=25', {
      headers: { 'Authorization': `Bearer ${session.token}` },
    });
    const data = await boardsRes.json();
    res.json({ boards: data.items || [], session_key: req.params.sessionKey });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch boards' });
  }
});
 
// Step 4 — get pins from a board
router.get('/pins/:sessionKey/:boardId', async (req, res) => {
  const session = tokenStore.get(req.params.sessionKey);
  if (!session) return res.status(404).json({ error: 'Session expired' });
 
  try {
    const pinsRes = await fetch(
      `https://api.pinterest.com/v5/boards/${req.params.boardId}/pins?page_size=48`,
      { headers: { 'Authorization': `Bearer ${session.token}` } }
    );
    const data = await pinsRes.json();
    const pins = (data.items || []).map(pin => ({
      id: pin.id,
      title: pin.title || '',
      image: pin.media?.images?.['400x']?.url || pin.media?.images?.['236x']?.url || null,
    }));
    res.json({ pins });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pins' });
  }
});
 
// Step 5 — match board or pin to products
router.post('/match', async (req, res) => {
  const { session_key, board_id } = req.body;
  const session = tokenStore.get(session_key);
  if (!session) return res.status(404).json({ error: 'Session expired' });
 
  try {
    const pinsRes = await fetch(
      `https://api.pinterest.com/v5/boards/${board_id}/pins?page_size=25`,
      { headers: { 'Authorization': `Bearer ${session.token}` } }
    );
    const pinsData = await pinsRes.json();
    const pins = pinsData.items || [];
    console.log(`Matching ${pins.length} pins from board ${board_id}`);
 
    const { data: products } = await supabase
      .from('products')
      .select(`*, brand:brands(name, verified, certifications)`)
      .eq('available', true)
      .order('sustainability_score', { ascending: false })
      .limit(24);
 
    res.json({ pins_found: pins.length, results: products || [] });
  } catch (err) {
    console.error('Match error:', err);
    res.status(500).json({ error: 'Matching failed' });
  }
});
 
export default router;
