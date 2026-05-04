import { Router } from 'express';
import { supabase } from '../lib/supabase.js';

const router = Router();

// GET /api/brands — list verified brands
router.get('/', async (req, res) => {
  const { category, country, certification, page = 1, limit = 24 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = supabase
    .from('brands')
    .select('*', { count: 'exact' })
    .eq('verified', true)
    .order('name');

  if (country) query = query.eq('country', country);
  if (certification) query = query.contains('certifications', [certification]);
  query = query.range(offset, offset + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ brands: data, total: count });
});

// GET /api/brands/:slug
router.get('/:slug', async (req, res) => {
  const { data, error } = await supabase
    .from('brands')
    .select(`*, products(id, title, price, images, sustainability_score, category)`)
    .eq('slug', req.params.slug)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Brand not found' });
  res.json(data);
});

// POST /api/brands/apply — brand verification application
router.post('/apply', async (req, res) => {
  const { brand_name, contact_email, website_url, annual_revenue_band, sustainability_statement, certifications_claimed } = req.body;

  if (!brand_name || !contact_email) {
    return res.status(400).json({ error: 'Brand name and contact email are required' });
  }

  const { data, error } = await supabase
    .from('brand_applications')
    .insert({ brand_name, contact_email, website_url, annual_revenue_band, sustainability_statement, certifications_claimed })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ message: 'Application received', id: data.id });
});

export default router;
