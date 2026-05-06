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
  { query: 'linen', category: 'bottoms' },
  { query: 'silk', category: 'dresses' },
  { query: 'wool', category: 'tops' },
  { query: 'leather jacket', category: 'outerwear' },
  { query: 'vintage', category: 'tops' },
];
 
async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
 
async function getVintedToken() {
  try {
    const res = await fetch('https://www.vinted.dk', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'da-DK,da;q=0.9,en-US;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
    });
    // Get cookies from response
    const cookies = res.headers.get('set-cookie') || '';
    return cookies;
  } catch (err) {
    console.error('Failed to get token:', err.message);
    return '';
  }
}
 
async function fetchVinted(query, cookies) {
  const params = new URLSearchParams({
    search_text: query,
    page: '1',
    per_page: '48',
    order: 'newest_first',
    currency: 'DKK',
  });
 
  try {
    const res = await fetch(
      `https://www.vinted.dk/api/v2/items?${params}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'da-DK,da;q=0.9,en-US;q=0.8',
          'Referer': 'https://www.vinted.dk/',
          'Origin': 'https://www.vinted.dk',
          'Cookie': cookies,
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: AbortSignal.timeout(20000),
      }
    );
 
    console.log(`  Vinted status: ${res.status}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  } catch (err) {
    console.error(`  Fetch error: ${err.message}`);
    return [];
  }
}
 
function score(item) {
  let s = 55;
  const t = (item.title || '').toLowerCase();
  const b = (item.brand_title || '').toLowerCase();
  if (t.includes('cashmere') || t.includes('kashmir')) s += 15;
  if (t.includes('linen') || t.includes('hør')) s += 12;
  if (t.includes('wool') || t.includes('uld')) s += 10;
  if (t.includes('silk') || t.includes('silke')) s += 10;
  if (t.includes('organic') || t.includes('økologisk')) s += 10;
  if (t.includes('vintage')) s += 8;
  if (t.includes('cotton') || t.includes('bomuld')) s += 5;
  if (t.includes('leather') || t.includes('læder')) s += 5;
  const goodBrands = ['nudie','filippa','samsøe','norse','aiayu','ganni','arket','cos','weekday','second female','gestuz','remains','rotate','wood wood'];
  if (goodBrands.some(x => b.includes(x))) s += 10;
  return Math.min(100, s);
}
 
function parse(item, category) {
  try {
    if (!item.id || !item.title) return null;
    const price = Math.round(parseFloat(item.price_numeric || 0) * 100);
    if (price === 0) return null;
    const images = (item.photos || []).map(p => p.url || p.full_size_url).filter(Boolean).slice(0, 4);
    return {
      source: 'vinted',
      source_id: String(item.id),
      source_url: `https://www.vinted.dk/items/${item.id}`,
      title: item.title,
      description: (item.description || '').substring(0, 500),
      price,
      currency: 'DKK',
      images,
      size_label: item.size_title || '',
      category: category || 'other',
      fibre_data_source: 'unknown',
      available: true,
      last_seen_at: new Date().toISOString(),
      sustainability_score: score(item),
    };
  } catch { return null; }
}
 
async function upsert(products) {
  if (!products.length) return 0;
  const { error } = await supabase.from('products').upsert(products, { onConflict: 'source,source_id' });
  if (error) { console.error('Upsert error:', error.message); return 0; }
  return products.length;
}
 
async function run() {
  console.log(`\n=== Vinted Scraper: ${new Date().toISOString()} ===`);
  
  console.log('Getting session cookies...');
  const cookies = await getVintedToken();
  console.log(`Got cookies: ${cookies ? 'yes' : 'no'}`);
  
  await sleep(3000);
  
  let total = 0;
  for (const { query, category } of SEARCHES) {
    console.log(`\nScraping: "${query}"`);
    const items = await fetchVinted(query, cookies);
    console.log(`  Found ${items.length} items`);
    const products = items.map(i => parse(i, category)).filter(Boolean);
    if (products.length > 0) {
      const saved = await upsert(products);
      total += saved;
      console.log(`  Saved ${saved}`);
    }
    await sleep(3000);
  }
  
  console.log(`\n=== Done. Total: ${total} ===`);
}
 
run().catch(err => { console.error('Crashed:', err); process.exit(1); });
