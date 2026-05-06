import { createClient } from '@supabase/supabase-js';
 
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
 
const SEARCHES = [
  { query: 'jeans dame', category: 'bottoms' },
  { query: 'kjole', category: 'dresses' },
  { query: 'blazer dame', category: 'outerwear' },
  { query: 'frakke dame', category: 'outerwear' },
  { query: 'nederdel', category: 'bottoms' },
  { query: 'støvler dame', category: 'shoes' },
  { query: 'cashmere sweater', category: 'tops' },
  { query: 'silke kjole', category: 'dresses' },
  { query: 'uld jakke', category: 'outerwear' },
  { query: 'læder jakke dame', category: 'outerwear' },
];
 
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
 
async function fetchDBA(query) {
  const url = `https://www.dba.dk/soeg/?soeg=${encodeURIComponent(query)}&sideNr=1&pris_fra=&pris_til=&type=S%C3%A6lger`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'da-DK,da;q=0.9',
      },
      signal: AbortSignal.timeout(20000),
    });
    console.log(`  DBA status: ${res.status}`);
    if (!res.ok) return [];
    const html = await res.text();
    return parseDBAHtml(html, query);
  } catch (err) {
    console.error(`  DBA error: ${err.message}`);
    return [];
  }
}
 
function parseDBAHtml(html, query) {
  const products = [];
  
  // Extract listing data from DBA HTML using regex patterns
  const listingPattern = /data-listingid="(\d+)"[^>]*>[\s\S]*?class="[^"]*heading[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>[\s\S]*?(\d+(?:\.\d+)?)\s*kr/g;
  let match;
  
  while ((match = listingPattern.exec(html)) !== null) {
    const [, id, titleRaw, priceRaw] = match;
    const title = titleRaw.replace(/<[^>]+>/g, '').trim();
    const price = Math.round(parseFloat(priceRaw.replace('.', '')) * 100);
    
    if (title && price > 0) {
      products.push({
        id,
        title,
        price,
        url: `https://www.dba.dk/advert/${id}/`,
      });
    }
  }
 
  // Alternative pattern for newer DBA layout
  if (products.length === 0) {
    const altPattern = /"id":(\d+),"heading":"([^"]+)"[^}]*"price":(\d+)/g;
    while ((match = altPattern.exec(html)) !== null) {
      const [, id, title, price] = match;
      products.push({
        id,
        title,
        price: parseInt(price) * 100,
        url: `https://www.dba.dk/advert/${id}/`,
      });
    }
  }
 
  return products;
}
 
function score(title) {
  let s = 55;
  const t = title.toLowerCase();
  if (t.includes('cashmere') || t.includes('kashmir')) s += 15;
  if (t.includes('hør') || t.includes('linen')) s += 12;
  if (t.includes('uld') || t.includes('wool')) s += 10;
  if (t.includes('silke') || t.includes('silk')) s += 10;
  if (t.includes('læder') || t.includes('leather')) s += 8;
  if (t.includes('vintage')) s += 8;
  if (t.includes('økologisk') || t.includes('organic')) s += 10;
  if (t.includes('nudie') || t.includes('filippa') || t.includes('norse') || t.includes('ganni')) s += 10;
  return Math.min(100, s);
}
 
function toProduct(item, category) {
  return {
    source: 'dba',
    source_id: String(item.id),
    source_url: item.url,
    title: item.title,
    description: '',
    price: item.price,
    currency: 'DKK',
    images: [],
    size_label: '',
    category,
    fibre_data_source: 'unknown',
    available: true,
    last_seen_at: new Date().toISOString(),
    sustainability_score: score(item.title),
  };
}
 
async function upsert(products) {
  if (!products.length) return 0;
  const { error } = await supabase.from('products').upsert(products, { onConflict: 'source,source_id' });
  if (error) { console.error('Upsert error:', error.message); return 0; }
  return products.length;
}
 
async function run() {
  console.log(`\n=== DBA Scraper: ${new Date().toISOString()} ===`);
  let total = 0;
  
  for (const { query, category } of SEARCHES) {
    console.log(`\nScraping DBA: "${query}"`);
    const items = await fetchDBA(query);
    console.log(`  Found ${items.length} items`);
    
    if (items.length > 0) {
      const products = items.map(i => toProduct(i, category));
      const saved = await upsert(products);
      total += saved;
      console.log(`  Saved ${saved}`);
    }
    await sleep(3000);
  }
  
  console.log(`\n=== Done. Total: ${total} ===`);
}
 
run().catch(err => { console.error('Crashed:', err); process.exit(1); });
