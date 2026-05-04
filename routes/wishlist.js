import { Router } from 'express';
import { supabase, getUserFromToken } from '../lib/supabase.js';

const router = Router();

async function requireAuth(req, res, next) {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

router.use(requireAuth);

// GET /api/wishlist
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('wishlist_items')
    .select(`*, product:products(*)`)
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/wishlist
router.post('/', async (req, res) => {
  const { product_id, hold } = req.body;
  if (!product_id) return res.status(400).json({ error: 'product_id is required' });

  const holdUntil = hold
    ? new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString()
    : null;

  const { data, error } = await supabase
    .from('wishlist_items')
    .upsert({ user_id: req.user.id, product_id, hold_until: holdUntil }, { onConflict: 'user_id,product_id' })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// DELETE /api/wishlist/:productId
router.delete('/:productId', async (req, res) => {
  const { error } = await supabase
    .from('wishlist_items')
    .delete()
    .eq('user_id', req.user.id)
    .eq('product_id', req.params.productId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

export default router;
