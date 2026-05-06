// vinted-scraper.js
// Pure JavaScript Vinted scraper — runs on Railway, no Python needed
// Fetches real second-hand listings and saves to Supabase

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SEARCHES = [
  { query: 'jeans', category: 'bottoms' },
  { query: 'kjole', category: 'dresses' },
  { query: 'blazer', category: 'outerwear' },
  { query: 'frakke', category: 'outerwear' },
  { query: 'nederdel', category: 'bottoms' },
  { query: 'støvler', category: 'shoes' },
  { query: 'cashmere', category: 'tops' },
  { query: 'hør bukser', category: 'bottoms' },
  { query: 'silke kjole', category: 'dresses' },
  { query: 'uld sweater', category: 'tops' },
  { query: 'læder jakke', category: 'outerwear' },
  { query: 'vintage', category: 'tops' },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'da-DK,da;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://www.vinted.dk/',
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchVinted(query, page = 1) {
  const params = new URLSearchParams({
    search_text: query,
    page: String(page),
    per_page: '48',
    order: 'newest_first',
    currency: 'DKK',
  });

  try {
    const res = await fetch(
      `https://www.vinted.dk/api/v2/items?${params}`,
      {
        headers: HEADERS,
        signal: AbortSignal.timeout(20000),
      }
    );

    if (!res.ok) {
      console.log(`Vinted returned ${res.status} for "${query}"`);
      return [];
    }

    const data = await res.json();
    return data.items || [];
  } catch (err) {
    console.error(`Fetch error for "${query}": ${err.message}`);
    return [];
  }
}

function scoreProduct(item) {
  // Base score for second-hand
  let score = 55;
  const title = (item.title || '').toLowerCase();
  const brand = (item.brand_title || '').toLowerCase();

  // Bonus for natural material keywords in title
  if (title.includes('cashmere') || title.includes('kashmir')) score += 15;
  if (title.includes('linen') || title.includes('hør')) score += 12;
  if (title.includes('wool') || title.includes('uld')) score += 10;
  if (title.includes('silk') || title.includes('silke')) score += 10;
  if (title.includes('cotton') || title.includes('bomuld')) score += 5;
  if (title.includes('leather') || title.includes('læder')) score += 5;
  if (title.includes('organic') || title.includes('økologisk')) score += 10;
  if (title.includes('vintage')) score += 8;

  // Bonus for known sustainable brands
  const sustainableBrands = [
    'nudie', 'filippa', 'samsøe', 'norse', 'aiayu', 'ganni',
    'arket', 'cos', 'weekday', 'monki', 'second female', 'gestuz',
    'remains', 'rotate', 'baum', 'wood wood', 'han kjøbenhavn'
  ];
  if (sustainableBrands.some(b => brand.includes(b))) score += 10;

  return Math.min(100, score);
}

function parseItem(item, category) {
  try {
    if (!item.id || !item.title) return null;

    const price = Math.round(parseFloat(item.price_numeric || 0) * 100);
    if (price === 0) return null;

    const images = (item.photos || [])
      .map(p => p.url || p.full_size_url || p.thumbnail_url)
      .filter(Boolean)
      .slice(0, 4);

    const sizeLabel = item.size_title || '';
    const sourceUrl = `https://www.vinted.dk/items/${item.id}-${(item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40)}`;

    return {
      source: 'vinted',
      source_id: String(item.id),
      source_url: sourceUrl,
      title: item.title,
      description: (item.description || '').substring(0, 500),
      price,
      currency: 'DKK',
      images,
      size_label: sizeLabel,
      category: category || 'other',
      fibre_data_source: 'unknown',
      available: true,
      last_seen_at: new Date().toISOString(),
      sustainability_score: scoreProduct(item),
      search_vector: null, // Supabase trigger handles this
    };
  } catch (err) {
    console.error('Parse error:', err.message);
    return null;
  }
}

async function upsert(products) {
  if (!products.length) return 0;

  // Add search vectors manually since trigger may not fire on upsert
  const withVectors = products.map(p => ({
    ...p,
    search_vector: undefined, // let DB handle it
  }));

  const { error } = await supabase
    .from('products')
    .upsert(withVectors, {
      onConflict: 'source,source_id',
      ignoreDuplicates: false,
    });

  if (error) {
    console.error('Upsert error:', error.message);
    return 0;
  }
  return products.length;
}

async function run() {
  console.log(`\n=== Vinted Scraper Started: ${new Date().toISOString()} ===`);
  let total = 0;

  for (const { query, category } of SEARCHES) {
    console.log(`\nScraping: "${query}" (${category})`);

    const items = await fetchVinted(query, 1);
    console.log(`  Found ${items.length} raw items`);

    const products = items.map(i => parseItem(i, category)).filter(Boolean);
    console.log(`  Parsed ${products.length} valid products`);

    if (products.length > 0) {
      const saved = await upsert(products);
      total += saved;
      console.log(`  Saved ${saved} to database`);
    }

    // Be polite — wait 2 seconds between searches
    await sleep(2000);
  }

  console.log(`\n=== Done. Total saved: ${total} ===\n`);
}

run().catch(err => {
  console.error('Scraper crashed:', err);
  process.exit(1);
});
