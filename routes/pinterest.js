import { Router } from 'express';
import { supabase, getUserFromToken } from '../lib/supabase.js';
 
const router = Router();
 
const PINTEREST_APP_ID = process.env.PINTEREST_APP_ID;
const PINTEREST_APP_SECRET = process.env.PINTEREST_APP_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://sparkly-longma-38df56.netlify.app';
const REDIRECT_URI = `${process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : 'http://localhost:3001'}/api/pinterest/callback`;
 
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
 
    // Fetch user's boards
    const boardsRes = await fetch('https://api.pinterest.com/v5/boards', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
    });
    const boardsData = await boardsRes.json();
    const boards = boardsData.items || [];
 
    // Save token to user profile if logged in
    if (userId && userId !== 'anonymous') {
      await supabase.from('users')
        .update({
          pinterest_board_url: `connected:${tokenData.access_token}`,
          pinterest_synced_at: new Date().toISOString(),
        })
        .eq('id', userId);
    }
 
    // Redirect back to frontend with boards data
    const boardsParam = encodeURIComponent(JSON.stringify(boards.slice(0, 20)));
    const tokenParam = encodeURIComponent(tokenData.access_token);
    res.redirect(`${FRONTEND_URL}/search?pinterest=success&token=${tokenParam}&boards=${boardsParam}`);
 
  } catch (err) {
    console.error('Pinterest callback error:', err);
    res.redirect(`${FRONTEND_URL}/search?pinterest=error`);
  }
});
 
// Step 3 — fetch pins from a board and find similar products
router.post('/match', async (req, res) => {
  const { access_token, board_id } = req.body;
 
  if (!access_token || !board_id) {
    return res.status(400).json({ error: 'access_token and board_id required' });
  }
 
  try {
    // Fetch pins from the board
    const pinsRes = await fetch(
      `https://api.pinterest.com/v5/boards/${board_id}/pins?page_size=25`,
      { headers: { 'Authorization': `Bearer ${access_token}` } }
    );
    const pinsData = await pinsRes.json();
    const pins = pinsData.items || [];
 
    // Extract image URLs from pins
    const imageUrls = pins
      .map(pin => pin.media?.images?.['600x']?.url || pin.media?.images?.['400x']?.url)
      .filter(Boolean);
 
    console.log(`Got ${imageUrls.length} pin images from board ${board_id}`);
 
    // For now return the image URLs — full CLIP matching comes when we have GPU server
    // Search our products for items that might match the board's aesthetic
    const { data: products } = await supabase
      .from('products')
      .select('*')
      .eq('available', true)
      .gte('sustainability_score', 60)
      .order('sustainability_score', { ascending: false })
      .limit(24);
 
    res.json({
      pins_found: imageUrls.length,
      results: products || [],
      note: 'Full visual matching coming soon — showing top-rated sustainable products for now',
    });
 
  } catch (err) {
    console.error('Pinterest match error:', err);
    res.status(500).json({ error: 'Matching failed' });
  }
});
 
export default router;
 
// Fetch pins from a specific board for single-pin selection
router.get('/pins/:sessionKey/:boardId', async (req, res) => {
  const session = tokenStore.get(req.params.sessionKey);
  if (!session) return res.status(404).json({ error: 'Session not found' });
 
  try {
    const pinsRes = await fetch(
      `https://api.pinterest.com/v5/boards/${req.params.boardId}/pins?page_size=48`,
      { headers: { 'Authorization': `Bearer ${session.token}` } }
    );
    const pinsData = await pinsRes.json();
    const pins = (pinsData.items || []).map(pin => ({
      id: pin.id,
      title: pin.title || '',
      image: pin.media?.images?.['400x']?.url || pin.media?.images?.['236x']?.url || null,
    }));
    res.json({ pins });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pins' });
  }
});
