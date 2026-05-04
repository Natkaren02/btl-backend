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

// POST /api/relist/:wardrobeItemId
// Generates a pre-filled Vinted listing URL for the item
router.post('/:itemId', async (req, res) => {
  const { data: item, error } = await supabase
    .from('wardrobe_items')
    .select('*')
    .eq('id', req.params.itemId)
    .eq('user_id', req.user.id)
    .single();

  if (error || !item) return res.status(404).json({ error: 'Item not found' });

  // Build a deep link to Vinted's "sell" flow with pre-filled data
  // Vinted doesn't have a public API for listing creation,
  // so we send the user to Vinted with query params as a starting point
  const params = new URLSearchParams({
    title: item.name || '',
    brand: item.brand || '',
    description: `Listed via BeyondTheLabel — original purchase: ${item.purchase_date || 'unknown'}`,
  });

  const vintedListUrl = `https://www.vinted.dk/sell?${params.toString()}`;

  // Mark as listed
  await supabase.from('wardrobe_items')
    .update({ listed_on_vinted: true })
    .eq('id', item.id);

  res.json({ redirect_url: vintedListUrl });
});

export default router;
