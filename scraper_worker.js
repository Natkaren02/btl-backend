// Vinted scraper worker — runs on a schedule via Railway
// Fetches real second-hand listings and saves to Supabase

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SEARCHES = [
  { query: 'jeans', category: 'bottoms' },
  { query: 'dress', category: 'dresses' },
  { query: 'blazer', category: 'outerwear' },
  { query: 'coat', category: 'outerwear' },
  { query: 'skirt', category: 'bottoms' },
  { query: 'boots', category: 'shoes' },
  { query: 'cashmere', category: 'tops' },
  { query: 'linen', category: 'tops' },
  { query: 'silk', category: 'dresses' },
  { query: 'wool', category: 'outerwear' },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'da-DK,da;q=0.9,en-US;q=0.8',
};

async function fetchVintedListings(query, page = 1) {
  const params = new URLSearchParams({
    search_text: query,
    page: page,
    per_page: '48',
    order: 'newest_first',
    currency: 'DKK',
  });

  try {
    const res = await fetch(
      `https://www.vinted.dk/api/v2/items?${params}`,
      { headers: HEADERS, signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  } catch (err) {
    console.error(`Vinted fetch error for "${query}":`, err.message);
    return [];
  }
}

function parseItem(item, category) {
  try {
    const price = Math.round(parseFloat(item.price_numeric || 0) * 100);
    const images = (item.photos || [])
      .map(p => p.url || p.full_size_url)
      .filter(Boolean)
      .slice(0, 4);

    const sizeLabel = item.size_title || '';
    const brandName = item.brand_title || '';

    return {
      source: 'vinted',
      source_id: String(item.id),
      source_url: `https://www.vinted.dk/items/${item.id}`,
      title: item.title || '',
      description: item.description || '',
      price,
      currency: 'DKK',
      images,
      size_label: sizeLabel,
      category: category || 'other',
      brand_name: brandName,
      fibre_data_source: 'unknown',
      available: true,
      last_seen_at: new Date().toISOString(),
      sustainability_score: 60, // base score for second-hand
    };
  } catch {
    return null;
  }
}

async function upsertProducts(products) {
  if (!products.length) return 0;
  const { data, error } = await supabase
    .from('products')
    .upsert(products, { onConflict: 'source,source_id', ignoreDuplicates: false });
  if (error) {
    console.error('Upsert error:', error.message);
    return 0;
  }
  return products.length;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('Starting Vinted scraper...', new Date().toISOString());
  let total = 0;

  for (const { query, category } of SEARCHES) {
    console.log(`Scraping: "${query}"`);
    const items = await fetchVintedListings(query, 1);

    const products = items
      .map(item => parseItem(item, category))
      .filter(Boolean);

    const count = await upsertProducts(products);
    total += count;
    console.log(`  → ${count} products saved`);

    await sleep(2000); // be polite between requests
  }

  console.log(`Done. Total products saved: ${total}`);
  process.exit(0);
}

run().catch(err => {
  console.error('Scraper failed:', err);
  process.exit(1);
});
