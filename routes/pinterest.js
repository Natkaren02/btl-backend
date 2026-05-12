import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { createJob, getJob, runBoardAnalysis, runPinAnalysis } from '../lib/jobs.js';

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
    const newPins = (data.items || []).map(pin => {
      const imgs = pin.media?.images || {};
      // Get highest resolution available
      const keys = Object.keys(imgs);
      const sorted = keys.sort((a, b) => {
        const getW = k => imgs[k]?.width || parseInt(k) || 0;
        return getW(b) - getW(a);
      });
      const imgUrl = sorted.length > 0 ? imgs[sorted[0]]?.url : null;
      return { id: pin.id, title: pin.title || 'Saved pin', image: imgUrl };
    });
    pins = [...pins, ...newPins];
    bookmark = data.bookmark || null;
  } while (bookmark);
  return pins;
}

async function getProfilePins(token) {
  const res = await fetch('https://api.pinterest.com/v5/pins?page_size=25', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  return (data.items || []).map(pin => {
    const imgs = pin.media?.images || {};
    const keys = Object.keys(imgs);
    const sorted = keys.sort((a, b) => {
      const getW = k => imgs[k]?.width || parseInt(k) || 0;
      return getW(b) - getW(a);
    });
    const imgUrl = sorted.length > 0 ? imgs[sorted[0]]?.url : null;
    return { id: pin.id, title: pin.title || 'Saved pin', image: imgUrl };
  });
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
  if (!code) return res.redirect(`${FRONTEND_URL}/style?pinterest=error`);
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
      return res.redirect(`${FRONTEND_URL}/style?pinterest=error`);
    }
    const sessionKey = Math.random().toString(36).substring(2, 12);
    await saveSession(sessionKey, tokenData.access_token);
    res.redirect(`${FRONTEND_URL}/style?pinterest=success&session=${sessionKey}`);
  } catch (err) {
    res.redirect(`${FRONTEND_URL}/style?pinterest=error`);
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
    res.json({ pins });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pins' });
  }
});

// Start async board analysis
router.post('/analyse-board', async (req, res) => {
  const { session_key, board_id } = req.body;
  const token = await getSession(session_key);
  if (!token) return res.status(404).json({ error: 'Session expired' });

  try {
    const pins = board_id === 'profile'
      ? await getProfilePins(token)
      : await getPins(token, board_id);

    const pinsWithImages = pins.filter(p => p.image);
    console.log(`Starting board analysis: ${pinsWithImages.length} pins with images`);

    const jobId = Math.random().toString(36).substring(2, 12);
    createJob(jobId, 'board');
    runBoardAnalysis(jobId, pins); // fire and forget

    res.json({ job_id: jobId, total_pins: pins.length, pins_with_images: pinsWithImages.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start analysis' });
  }
});

// Start async single pin analysis
router.post('/analyse-pin', async (req, res) => {
  const { session_key, pin_image } = req.body;
  if (!pin_image) return res.status(400).json({ error: 'pin_image required' });

  const jobId = Math.random().toString(36).substring(2, 12);
  createJob(jobId, 'pin');
  runPinAnalysis(jobId, pin_image); // fire and forget

  res.json({ job_id: jobId });
});

// Poll job status
router.get('/job/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

export default router;
