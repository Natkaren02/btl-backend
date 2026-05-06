import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
 
const router = Router();
 
const PINTEREST_APP_ID = process.env.PINTEREST_APP_ID;
const PINTEREST_APP_SECRET = process.env.PINTEREST_APP_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://sparkly-longma-38df56.netlify.app';
const BACKEND_URL = 'https://btl-backend-production-f682.up.railway.app';
const REDIRECT_URI = `${BACKEND_URL}/api/pinterest/callback`;
 
async function saveSession(key, token) {
  await supabase.from('pinterest_sessions').upsert({ session_key: key, access_token: token });
}
 
async function getSession(key) {
  const { data } = await supabase.from('pinterest_sessions').select('access_token').eq('session_key', key).single();
  return data?.access_token || null;
}
 
router.get('/auth', (req, res) => {
  const params = new URLSearchParams({
    client_id: PINTEREST_APP_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'boards:read,pins:read',
    state: 'btl',
  });
  res.redirect(`https://www.pinterest.com/oauth/?${params}`);
});
 
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
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
    });
 
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('Token error:', tokenData);
      return res.redirect(`${FRONTEND_URL}/search?pinterest=error`);
    }
 
    const sessionKey = Math.random().toString(36).substring(2, 12);
    await saveSession(sessionKey, tokenData.access_token);
    res.redirect(`${FRONTEND_URL}/search?pinterest=success&session=${sessionKey}`);
 
  } catch (err) {
    console.error('Callback error:', err);
    res.redirect(`${FRONTEND_URL}/search?pinterest=error`);
  }
});
 
router.get('/boards/:sessionKey', async (req, res) => {
  const token = await getSession(req.params.sessionKey);
  if (!token) return res.status(404).json({ error: 'Session expired' });
 
  try {
    const r = await fetch('https://api.pinterest.com/v5/boards?page_size=25', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await r.json();
    res.json({ boards: data.items || [], session_key: req.params.sessionKey });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch boards' });
  }
});
 
router.get('/pins/:sessionKey/:boardId', async (req, res) => {
  const token = await getSession(req.params.sessionKey);
  if (!token) return res.status(404).json({ error: 'Session expired' });
 
  try {
    const r = await fetch(
      `https://api.pinterest.com/v5/boards/${req.params.boardId}/pins?page_size=48`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await r.json();
    console.log('Pins response:', JSON.stringify(data).substring(0, 200));
    const pins = (data.items || []).map(pin => ({
      id: pin.id,
      title: pin.title || '',
      image: pin.media?.images?.['400x']?.url || pin.media?.images?.['236x']?.url || pin.media?.images?.['170x']?.url || null,
    }));
    res.json({ pins });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pins' });
  }
});
 
router.post('/match', async (req, res) => {
  const { session_key, board_id } = req.body;
  const token = await getSession(session_key);
  if (!token) return res.status(404).json({ error: 'Session expired' });
 
  try {
    const r = await fetch(
      `https://api.pinterest.com/v5/boards/${board_id}/pins?page_size=25`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const pinsData = await r.json();
    console.log(`Matching ${pinsData.items?.length || 0} pins`);
 
    const { data: products } = await supabase
      .from('products')
      .select(`*, brand:brands(name, verified, certifications)`)
      .eq('available', true)
      .order('sustainability_score', { ascending: false })
      .limit(24);
 
    res.json({ pins_found: pinsData.items?.length || 0, results: products || [] });
  } catch (err) {
    res.status(500).json({ error: 'Matching failed' });
  }
});
 
export default router;
