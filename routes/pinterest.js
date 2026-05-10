import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { analyseImage, analyseBoard } from '../lib/vision.js';
 
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
 
async function getAllBoards(token) {
  let boards = [];
  let bookmark = null;
  do {
    const url = new URL('https://api.pinterest.com/v5/boards');
    url.searchParams.set('page_size', '25');
    if (bookmark) url.searchParams.set('bookmark', bookmark);
    const res = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    boards = [...boards, ...(data.items || [])];
    bookmark = data.bookmark || null;
  } while (bookmark);
  return boards;
}
 
async function getPins(token, boardId) {
  let pins = [];
  let bookmark = null;
  do {
    const url = new URL(`https://api.pinterest.com/v5/boards/${boardId}/pins`);
    url.searchParams.set('page_size', '25');
    if (bookmark) url.searchParams.set('bookmark', bookmark);
    const res = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (data.items?.length > 0 && pins.length === 0) {
      console.log('Raw pin sample:', JSON.stringify(data.items[0]).substring(0, 600));
    }
    const newPins = (data.items || []).map(pin => {
      const imgs = pin.media?.images || {};
      const keys = Object.keys(imgs);
      const imgUrl = keys.length > 0 ? imgs[keys[0]]?.url : null;
      return { id: pin.id, title: pin.title || 'Saved pin', image: imgUrl };
    });
    pins = [...pins, ...newPins];
    bookmark = data.bookmark || null;
  } while (bookmark && pins.length < 100);
  return pins;
}
 
async function getProfilePins(token) {
  const res = await fetch('https://api.pinterest.com/v5/pins?page_size=25', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  if (data.items?.length > 0) {
    console.log('Raw profile pin sample:', JSON.stringify(data.items[0]).substring(0, 600));
  }
  return (data.items || []).map(pin => {
    const imgs = pin.media?.images || {};
    const keys = Object.keys(imgs);
    const imgUrl = keys.length > 0 ? imgs[keys[0]]?.url : null;
    return { id: pin.id, title: pin.title || 'Saved pin', image: imgUrl };
  });
}
 
async function searchProducts(searchTerms) {
  const allProducts = [];
  const seenIds = new Set();
 
  for (const term of (searchTerms || []).slice(0, 5)) {
    try {
      const { data } = await supabase
        .from('products')
        .select('*, brand:brands(name, verified, certifications)')
        .eq('available', true)
        .textSearch('search_vector', term, { type: 'websearch', config: 'english' })
        .order('sustainability_score', { ascending: false })
        .limit(10);
      for (const p of data || []) {
        if (!seenIds.has(p.id)) { seenIds.add(p.id); allProducts.push(p); }
      }
    } catch {}
  }
 
  // Fallback to top scored products if not enough results
  if (allProducts.length < 12) {
    const { data: fallback } = await supabase
      .from('products')
      .select('*, brand:brands(name, verified, certifications)')
      .eq('available', true)
      .order('sustainability_score', { ascending: false })
      .limit(24);
    for (const p of fallback || []) {
      if (!seenIds.has(p.id)) { seenIds.add(p.id); allProducts.push(p); }
    }
  }
 
  return allProducts.slice(0, 24);
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
 
router.get('/boards/:sessionKey', async (req, res) => {
  const token = await getSession(req.params.sessionKey);
  if (!token) return res.status(404).json({ error: 'Session expired' });
  try {
    const boards = await getAllBoards(token);
    const allBoards = [
      { id: 'profile', name: 'All saved pins (profile)' },
      ...boards
    ];
    res.json({ boards: allBoards, session_key: req.params.sessionKey });
  } catch (err) {
    console.error('Boards error:', err);
    res.status(500).json({ error: 'Failed to fetch boards' });
  }
});
 
router.get('/pins/:sessionKey/:boardId', async (req, res) => {
  const token = await getSession(req.params.sessionKey);
  if (!token) return res.status(404).json({ error: 'Session expired' });
  try {
    const pins = req.params.boardId === 'profile'
      ? await getProfilePins(token)
      : await getPins(token, req.params.boardId);
    console.log(`Fetched ${pins.length} pins, images: ${pins.filter(p => p.image).length}`);
    res.json({ pins });
  } catch (err) {
    console.error('Pins error:', err);
    res.status(500).json({ error: 'Failed to fetch pins' });
  }
});
 
// Analyse whole board using Claude vision
router.post('/match', async (req, res) => {
  const { session_key, board_id } = req.body;
  const token = await getSession(session_key);
  if (!token) return res.status(404).json({ error: 'Session expired' });
  try {
    const pins = board_id === 'profile'
      ? await getProfilePins(token)
      : await getPins(token, board_id);
    console.log(`Analysing ${pins.length} pins from ${board_id}`);
 
    // Use Claude vision to analyse board images
    const analysis = await analyseBoard(pins);
    console.log('Style analysis:', analysis.summary);
 
    const products = await searchProducts(analysis.search_terms);
 
    res.json({
      pins_found: pins.length,
      results: products,
      analysis: {
        summary: analysis.summary,
        style_vibe: analysis.style_vibe,
        colours: analysis.dominant_colours || [],
        materials: analysis.dominant_materials || [],
        search_terms: analysis.search_terms || [],
      }
    });
  } catch (err) {
    console.error('Match error:', err);
    res.status(500).json({ error: 'Matching failed' });
  }
});
 
// Analyse single pin — every component of the outfit
router.post('/match-pin', async (req, res) => {
  const { session_key, pin_image, pin_id } = req.body;
  const token = await getSession(session_key);
  if (!token) return res.status(404).json({ error: 'Session expired' });
  if (!pin_image) return res.status(400).json({ error: 'No image provided' });
  try {
    console.log(`Analysing single pin: ${pin_id}`);
    const analysis = await analyseImage(pin_image);
    const products = await searchProducts(analysis?.search_terms);
    res.json({
      results: products,
      analysis: {
        items: analysis?.items || [],
        overall_vibe: analysis?.overall_vibe,
        search_terms: analysis?.search_terms || [],
      }
    });
  } catch (err) {
    console.error('Pin match error:', err);
    res.status(500).json({ error: 'Matching failed' });
  }
});
 
export default router;
