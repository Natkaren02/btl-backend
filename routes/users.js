import { Router } from 'express';
import { supabase, getUserFromToken } from '../lib/supabase.js';
import { process_pinterest_board } from '../lib/clip.js';

const router = Router();

async function requireAuth(req, res, next) {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

// GET /api/users/me
router.get('/me', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/users/me — update profile/preferences
router.patch('/me', requireAuth, async (req, res) => {
  const allowed = ['size_eu', 'size_uk', 'size_us', 'size_top', 'size_shoe_eu',
    'budget_min', 'budget_max', 'preferred_sources', 'exclude_synthetics', 'wishlist_hold_enabled'];

  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const { data, error } = await supabase
    .from('users')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', req.user.id)
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/users/pinterest — connect Pinterest board
router.post('/pinterest', requireAuth, async (req, res) => {
  const { board_url } = req.body;
  if (!board_url) return res.status(400).json({ error: 'board_url is required' });

  try {
    // This calls the Python CLIP script via a child process
    // In production this would be a separate Python microservice
    const { execSync } = await import('child_process');
    const output = execSync(
      `python lib/clip.py --board-url "${board_url}"`,
      { encoding: 'utf8', timeout: 120000 }
    );
    const results = JSON.parse(output);

    // Save board URL to user profile
    await supabase.from('users')
      .update({ pinterest_board_url: board_url, pinterest_synced_at: new Date().toISOString() })
      .eq('id', req.user.id);

    res.json(results);
  } catch (err) {
    console.error('Pinterest error:', err.message);
    res.status(500).json({ error: 'Failed to process Pinterest board. Check the board is public.' });
  }
});

export default router;
