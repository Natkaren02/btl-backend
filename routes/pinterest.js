import { Router } from 'express';
import { supabase, getUserFromToken } from '../lib/supabase.js';
 
const router = Router();
 
const PINTEREST_APP_ID = process.env.PINTEREST_APP_ID;
const PINTEREST_APP_SECRET = process.env.PINTEREST_APP_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://sparkly-longma-38df56.netlify.app';
const BACKEND_URL = `https://btl-backend-production-f682.up.railway.app`;
const REDIRECT_URI = `${BACKEND_URL}/api/pinterest/callback`;
 
// Temporary in-memory store for tokens (replace with DB in production)
const tokenStore = new Map();
 
// Step 1 — redirect user to Pinterest login
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
 
// Step 2 — Pinterest redirects back here with a code
router.get('/callback', async (req, res) => {
  const { code, state: userId } = req.query;
 
  if (!code) {
    return res.redirect(`${FRONTEND_URL}/search?pinterest=error`);
  }
 
  try {
    // Exchange code for access token
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
      console.error('Pinterest token error:', tokenData);
      return res.redirect(`${FRONTEND_URL}/search?pinterest=error`);
    }
 
    // Generate a short session key instead of passing token in URL
    const sessionKey = Math.random().toString(36).substring(2, 15);
    tokenStore.set(sessionKey, {
      token: tokenData.access_token,
      userId,
      created: Date.now(),
    });
 
    // Redirect with just the short session key
    res.redirect(`${FRONTEND_URL}/search?pinterest=success&session=${sessionKey}`);
 
  } catch (err) {
    console.error('Pinterest callback error:', err);
    res.redirect(`${FRONTEND_URL}/search?pinterest=error`);
  }
});
 
// Step 3 — frontend exchanges session key for boards
router.get('/boards/:sessionKey', async (req, res) => {
  const session = tokenStore.get(req.params.sessionKey);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
 
  try {
    const boardsRes = await fetch('https://api.pinterest.com/v5/boards?page_size=25', {
      headers: { 'Authorization': `Bearer ${session.token}` },
    });
    const boardsData = await boardsRes.json();
    res.json({
      boards: boardsData.items || [],
      session_key: req.params.sessionKey,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch boards' });
  }
});
 
// Step 4 — match pins from a board to products
router.post('/match', async (req, res) => {
  const { session_key, board_id } = req.body;
 
  const session = tokenStore.get(session_key);
  if (!session) return res.status(404).json({ error: 'Session not found' });
 
  try {
    // Fetch pins
    const pinsRes = await fetch(
      `https://api.pinterest.com/v5/boards/${board_id}/pins?page_size=25`,
      { headers: { 'Authorization': `Bearer ${session.token}` } }
    );
    const pinsData = await pinsRes.json();
    const pins = pinsData.items || [];
 
    console.log(`Got ${pins.length} pins from board ${board_id}`);
 
    // Get top sustainable products for now
    // Full CLIP visual matching will be added when GPU server is available
    const { data: products } = await supabase
      .from('products')
      .select(`*, brand:brands(name, verified, certifications)`)
      .eq('available', true)
      .order('sustainability_score', { ascending: false })
      .limit(24);
 
    res.json({
      pins_found: pins.length,
      results: products || [],
    });
 
  } catch (err) {
    console.error('Match error:', err);
    res.status(500).json({ error: 'Matching failed' });
  }
});
 
export default router;
