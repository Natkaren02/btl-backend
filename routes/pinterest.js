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
 
// Fetch ALL boards by paginating through all pages
async function getAllBoards(token) {
  let boards = [];
  let bookmark = null;
  
  do {
    const url = new URL('https://api.pinterest.com/v5/boards');
    url.searchParams.set('page_size', '25');
    if (bookmark) url.searchParams.set('bookmark', bookmark);
    
    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    boards = [...boards, ...(data.items || [])];
    bookmark = data.bookmark || null;
  } while (bookmark);
  
  return boards;
}
 
// Fetch ALL pins from a board by paginating
async function getAllPins(token, boardId) {
  let pins = [];
  let bookmark = null;
  
  do {
    const url = new URL(`https://api.pinterest.com/v5/boards/${boardId}/pins`);
    url.searchParams.set('page_size', '25');
    if (bookmark) url.searchParams.set('bookmark', bookmark);
    
    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const newPins = (data.items || []).map(pin => ({
      id: pin.id,
      title: pin.title || '',
      image: pin.media?.images?.['400x']?.url || 
             pin.media?.images?.['236x']?.url || 
             pin.media?.images?.['170x']?.url || null,
    }));
    pins = [...pins, ...newPins];
    bookmark = data.bookmark || null;
  } while (bookmark && pins.length < 100); // max 100 pins
  
  return pins;
}
 
// Fetch pins saved directly to profile (not in boards)
async function getProfilePins(token) {
  try {
    const res = await fetch('https://api.pinterest.com/v5/pins?page_size=25', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    return (data.items || []).map(pin => ({
      id: pin.id,
      title: pin.title || 'Saved pin',
      image: pin.media?.images?.['400x']?.url ||
             pin.media?.images?.['236x']?.url || null,
    }));
  } catch {
    return [];
  }
}
 
router.get('/auth', (req, res) => {
  const params = new URLSearchParams({
    client_id: PINTEREST_APP_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'boards:read,pins:read,user_accounts:read',
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
 
// Get ALL boards + profile pins option
router.get('/boards/:sessionKey', async (req, res) => {
  const token = await getSession(req.params.sessionKey);
  if (!token) return res.status(404).json({ error: 'Session expired — please reconnect Pinterest' });
 
  try {
    const boards = await getAllBoards(token);
    console.log(`Fetched ${boards.length} boards`);
    
    // Add a special "All saved pins" option at the top
    const allBoards = [
      { id: 'profile', name: '✦ All saved pins (profile)', description: 'Pins saved directly to your profile' },
      ...boards
    ];
    
    res.json({ boards: allBoards, session_key: req.params.sessionKey });
  } catch (err) {
    console.error('Boards error:', err);
    res.status(500).json({ error: 'Failed to fetch boards' });
  }
});
 
// Get pins from a board or profile
router.get('/pins/:sessionKey/:boardId', async (req, res) => {
  const token = await getSession(req.params.sessionKey);
  if (!token) return res.status(404).json({ error: 'Session expired' });
 
  try {
    let pins;
    if (req.params.boardId === 'profile') {
      pins = await getProfilePins(token);
    } else {
      pins = await getAllPins(token, req.params.boardId);
    }
    console.log(`Fetched ${pins.length} pins from ${req.params.boardId}`);
    res.json({ pins });
  } catch (err) {
    console.error('Pins error:', err);
    res.status(500).json({ error: 'Failed to fetch pins' });
  }
});
 
// Match board or profile pins to products
router.post('/match', async (req, res) => {
  const { session_key, board_id } = req.body;
  const token = await getSession(session_key);
  if (!token) return res.status(404).json({ error: 'Session expired' });
 
  try {
    let pins;
    if (board_id === 'profile') {
      pins = await getProfilePins(token);
    } else {
      pins = await getAllPins(token, board_id);
    }
    console.log(`Matching against ${pins.length} pins from ${board_id}`);
 
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
