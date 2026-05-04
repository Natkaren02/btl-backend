import { Router } from 'express';
import { supabase, getUserFromToken } from '../lib/supabase.js';
import { calculateScore } from '../lib/scoring.js';
import { lookupFibreData } from '../lib/fibre.js';

const router = Router();

/**
 * GET /api/search
 *
 * Query params:
 *   q         - search query (required)
 *   sources   - comma-separated: vinted,dba,sellply,brand_direct
 *   category  - tops,bottoms,dresses,outerwear,shoes,accessories
 *   size_eu   - EU size filter
 *   min_price - min price in DKK
 *   max_price - max price in DKK
 *   min_score - minimum sustainability score (0-100)
 *   verified_only - 'true' to show only verified brand products
 *   sort      - relevance|price_asc|price_desc|score_desc|newest
 *   page      - page number (default 1)
 *   limit     - results per page (default 24, max 48)
 */
router.get('/', async (req, res) => {
  try {
    const {
      q,
      sources,
      category,
      size_eu,
      min_price,
      max_price,
      min_score,
      verified_only,
      sort = 'relevance',
      page = 1,
      limit = 24,
    } = req.query;

    if (!q?.trim()) {
      return res.status(400).json({ error: 'Search query (q) is required' });
    }

    // Optionally load user preferences if logged in
    const user = await getUserFromToken(req.headers.authorization);
    let userPrefs = null;
    if (user) {
      const { data } = await supabase
        .from('users')
        .select('size_eu, budget_min, budget_max, preferred_sources, exclude_synthetics')
        .eq('id', user.id)
        .single();
      userPrefs = data;
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(48, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // Build query
    let query = supabase
      .from('products')
      .select(`
        *,
        brand:brands (
          id, name, slug, verified, certifications,
          primary_materials, avoids_synthetics, logo_url
        )
      `, { count: 'exact' })
      .eq('available', true);

    // Full text search
    if (q) {
      query = query.textSearch('search_vector', q.trim(), {
        type: 'websearch',
        config: 'english'
      });
    }

    // Source filter
    const sourcesArr = sources
      ? sources.split(',').filter(Boolean)
      : (userPrefs?.preferred_sources ?? ['vinted', 'dba', 'sellply', 'brand_direct']);

    // Map user-friendly names to DB values
    const sourceMap = {
      'second-hand': ['vinted', 'dba'],
      'verified-brands': ['sellply', 'brand_direct'],
      'vinted': ['vinted'],
      'dba': ['dba'],
      'sellply': ['sellply'],
      'brand_direct': ['brand_direct'],
    };
    const dbSources = [...new Set(sourcesArr.flatMap(s => sourceMap[s] ?? [s]))];
    if (dbSources.length) query = query.in('source', dbSources);

    // Category filter
    if (category) query = query.eq('category', category);

    // Size filter (use user prefs as fallback)
    const sizeFilter = size_eu || userPrefs?.size_eu;
    if (sizeFilter) query = query.or(`size_eu.eq.${sizeFilter},size_eu.is.null`);

    // Price filter (convert DKK to øre)
    const minPrice = parseInt(min_price ?? userPrefs?.budget_min ?? 0) * 100;
    const maxPrice = parseInt(max_price ?? userPrefs?.budget_max ?? 99999) * 100;
    query = query.gte('price', minPrice).lte('price', maxPrice);

    // Sustainability score filter
    if (min_score) query = query.gte('sustainability_score', parseInt(min_score));

    // Verified brands only
    if (verified_only === 'true') {
      query = query.eq('brands.verified', true);
    }

    // Sorting
    switch (sort) {
      case 'price_asc':  query = query.order('price', { ascending: true }); break;
      case 'price_desc': query = query.order('price', { ascending: false }); break;
      case 'score_desc': query = query.order('sustainability_score', { ascending: false, nullsFirst: false }); break;
      case 'newest':     query = query.order('created_at', { ascending: false }); break;
      default:           query = query.order('sustainability_score', { ascending: false, nullsFirst: false }); break;
    }

    // Pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data: products, error, count } = await query;

    if (error) {
      console.error('Search error:', error);
      return res.status(500).json({ error: 'Search failed' });
    }

    // Enrich products that are missing fibre data (second-hand)
    const enriched = await Promise.all(
      (products ?? []).map(async (product) => {
        let { fibre_data, fibre_data_source } = product;

        // If second-hand and no fibre data, try brand lookup
        if (['vinted', 'dba'].includes(product.source) && !fibre_data) {
          const brandName = product.title?.split(' ')[0] ?? '';
          const lookup = await lookupFibreData(brandName, product.title);
          fibre_data = lookup.fibre_data;
          fibre_data_source = lookup.source;
        }

        // Recalculate score with enriched fibre data
        const { score } = calculateScore({ ...product, fibre_data, fibre_data_source });

        return {
          ...product,
          fibre_data,
          fibre_data_source: fibre_data_source ?? 'unknown',
          sustainability_score: score,
          // Price in DKK for frontend (stored as øre)
          price_dkk: Math.round(product.price / 100),
        };
      })
    );

    // Log search for recommendations
    if (user) {
      supabase.from('search_history').insert({
        user_id: user.id,
        query: q,
        filters: { sources, category, size_eu, min_price, max_price, sort },
        results_count: count ?? 0,
      }).then(() => {}); // fire and forget
    }

    res.json({
      results: enriched,
      pagination: {
        total: count ?? 0,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil((count ?? 0) / limitNum),
      },
      query: q,
    });

  } catch (err) {
    console.error('Unexpected search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /api/search/similar/:productId
 * Returns visually similar products using CLIP embeddings
 * (requires pgvector extension in Supabase)
 */
router.get('/similar/:productId', async (req, res) => {
  try {
    const { productId } = req.params;

    // Get the product's embedding
    const { data: product, error } = await supabase
      .from('products')
      .select('clip_embedding, category')
      .eq('id', productId)
      .single();

    if (error || !product?.clip_embedding) {
      return res.status(404).json({ error: 'Product not found or no visual data' });
    }

    // Vector similarity search using pgvector cosine distance
    // This requires the pgvector extension in Supabase
    const { data: similar } = await supabase.rpc('match_products', {
      query_embedding: product.clip_embedding,
      match_threshold: 0.78,
      match_count: 12,
      filter_category: product.category,
    });

    res.json({ results: similar ?? [] });

  } catch (err) {
    console.error('Similar search error:', err);
    res.status(500).json({ error: 'Similar search failed' });
  }
});

export default router;
