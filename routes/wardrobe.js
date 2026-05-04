import { Router } from 'express';
import { supabase, getUserFromToken } from '../lib/supabase.js';

const router = Router();

// Auth middleware — all wardrobe routes require login
async function requireAuth(req, res, next) {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

router.use(requireAuth);

// GET /api/wardrobe — get all wardrobe items
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('wardrobe_items')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Add cost-per-wear to each item
  const withCpw = data.map(item => ({
    ...item,
    price_dkk: item.purchase_price ? Math.round(item.purchase_price / 100) : null,
    cost_per_wear: item.purchase_price && item.times_worn > 0
      ? Math.round(item.purchase_price / item.times_worn / 100)
      : item.purchase_price ? Math.round(item.purchase_price / 100) : null,
  }));

  res.json(withCpw);
});

// POST /api/wardrobe — add item to wardrobe
router.post('/', async (req, res) => {
  const {
    name, brand, category, color, image_url,
    purchase_price, purchase_date, source,
    fibre_data, sustainability_score
  } = req.body;

  if (!name) return res.status(400).json({ error: 'Item name is required' });

  const { data, error } = await supabase
    .from('wardrobe_items')
    .insert({
      user_id: req.user.id,
      name, brand, category, color, image_url,
      purchase_price: purchase_price ? Math.round(purchase_price * 100) : null,
      purchase_date, source, fibre_data, sustainability_score,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/wardrobe/:id/wear — log a wear
router.patch('/:id/wear', async (req, res) => {
  // First get current count
  const { data: item, error: fetchErr } = await supabase
    .from('wardrobe_items')
    .select('times_worn')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (fetchErr || !item) return res.status(404).json({ error: 'Item not found' });

  const { data, error } = await supabase
    .from('wardrobe_items')
    .update({
      times_worn: (item.times_worn || 0) + 1,
      last_worn_at: new Date().toISOString().split('T')[0],
    })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/wardrobe/:id — remove from wardrobe
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('wardrobe_items')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// GET /api/wardrobe/similar?name=X&category=Y
// Check if user already owns something similar before buying
router.get('/similar', async (req, res) => {
  const { name, category } = req.query;
  if (!name) return res.json({ similar: [] });

  const { data, error } = await supabase
    .from('wardrobe_items')
    .select('id, name, category, color, image_url')
    .eq('user_id', req.user.id)
    .textSearch('name', name, { type: 'websearch' })
    .limit(3);

  const categoryMatches = category ? data?.filter(i => i.category === category) : data;
  res.json({ similar: error ? [] : (categoryMatches ?? []) });
});

export default router;
