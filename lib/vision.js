// vision.js — uses OpenAI GPT-4o-mini to analyse Pinterest pin images
// Extracts precise fashion attributes for accurate product matching

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function callOpenAI(prompt, imageUrl = null) {
  const messages = [{
    role: 'user',
    content: imageUrl ? [
      { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
      { type: 'text', text: prompt }
    ] : [{ type: 'text', text: prompt }]
  }];

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 2048,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();
    if (data.error) {
      console.error('OpenAI error:', data.error.message);
      return null;
    }

    const text = data.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('No JSON in response:', text.substring(0, 100));
      return null;
    }
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('OpenAI call error:', err.message);
    return null;
  }
}

export async function analyseImage(imageUrl) {
  if (!imageUrl) return null;

  const prompt = `You are a precise fashion analyst. Look at this image carefully and identify EVERY clothing item, accessory, shoe, bag, jewellery piece visible.

For each item return exact details. Be VERY specific about colours (not just "blue" but "indigo", "cobalt", "powder blue"). Be specific about fit (not just "jeans" but "low rise wide leg", "high waisted straight leg", "mid rise bootcut").

Return ONLY valid JSON, no other text:

{
  "items": [
    {
      "category": "bottoms|tops|dresses|outerwear|shoes|bags|accessories|jewellery|hats|scarves|belts|sunglasses",
      "subcategory": "specific e.g. wide leg jeans, silk slip dress, oversized blazer, ankle boots, shoulder bag",
      "colour": "PRECISE colour e.g. indigo, eggshell white, camel, chocolate brown, forest green, burgundy",
      "material": "e.g. denim, silk, wool, leather, linen, cashmere, cotton, velvet, satin",
      "fit": "e.g. wide leg, straight leg, bootcut, slim, skinny, oversized, fitted, relaxed, boxy, cropped, maxi, midi, mini",
      "rise": "low rise|mid rise|high rise (bottoms only)",
      "length": "e.g. ankle, knee length, midi, maxi, cropped, hip length (where relevant)",
      "collar": "e.g. crew neck, v-neck, turtleneck, collar, off shoulder (tops/dresses only)",
      "details": "specific design details e.g. raw hem, button front, ribbed knit, pleated, asymmetric, belted, fur trim",
      "style_vibe": "e.g. 90s grunge, minimalist, Scandinavian, vintage 70s, quiet luxury, Y2K, bohemian"
    }
  ],
  "overall_vibe": "2-4 word aesthetic description",
  "search_terms": ["8-10 VERY specific search terms for finding similar items, including colour and fit e.g. low rise indigo wide leg jeans raw hem, cream oversized wool coat belted, black silk spaghetti strap midi dress"]
}`;

  return await callOpenAI(prompt, imageUrl);
}

export async function analyseBoard(pins) {
  // Analyse up to 20 pins for a comprehensive picture
  const pinsWithImages = pins.filter(p => p.image).slice(0, 20);

  if (pinsWithImages.length === 0) {
    return { summary: 'No images to analyse', search_terms: ['sustainable fashion'] };
  }

  console.log(`Analysing ${pinsWithImages.length} pins...`);

  // Analyse pins in parallel batches of 5 to speed things up
  const batchSize = 5;
  const allAnalyses = [];
  
  for (let i = 0; i < pinsWithImages.length; i += batchSize) {
    const batch = pinsWithImages.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(pin => analyseImage(pin.image))
    );
    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        allAnalyses.push(result.value);
      }
    }
    console.log(`Batch ${Math.floor(i/batchSize) + 1} done: ${allAnalyses.length} analysed so far`);
  }

  if (allAnalyses.length === 0) {
    return { summary: 'Could not analyse images', search_terms: ['sustainable fashion'] };
  }

  const allItems = allAnalyses.flatMap(a => a.items || []);
  const allSearchTerms = allAnalyses.flatMap(a => a.search_terms || []);
  const allVibes = allAnalyses.map(a => a.overall_vibe).filter(Boolean);

  // Count occurrences of each attribute value
  const countBy = (items, key) => {
    const counts = {};
    for (const item of items) {
      const val = item[key];
      if (val) counts[val] = (counts[val] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, count }));
  };

  // Build detailed breakdown per category
  const byCategory = {};
  for (const item of allItems) {
    const key = item.subcategory || item.category || 'other';
    if (!byCategory[key]) byCategory[key] = [];
    byCategory[key].push(item);
  }

  // For each category, build colour/fit/rise counts
  const categoryBreakdown = Object.entries(byCategory)
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([name, items]) => ({
      name,
      count: items.length,
      colours: countBy(items, 'colour'),
      fits: countBy(items, 'fit'),
      rises: countBy(items, 'rise'),
      materials: countBy(items, 'material'),
      details: countBy(items, 'details'),
      items, // keep raw items for display
    }));

  const dominantColours = countBy(allItems, 'colour').slice(0, 5).map(c => c.value);
  const dominantMaterials = countBy(allItems, 'material').slice(0, 4).map(m => m.value);
  const dominantVibes = countBy(allVibes.map(v => ({ vibe: v })), 'vibe')
    .slice(0, 2).map(v => v.value);

  // Deduplicate and prioritise search terms
  const uniqueTerms = [...new Set(allSearchTerms)].slice(0, 12);

  // Build summary
  const summaryParts = [];
  if (dominantColours.length) summaryParts.push(dominantColours.slice(0, 2).join(' and '));
  if (dominantMaterials.length) summaryParts.push(dominantMaterials.slice(0, 2).join(' and '));
  if (allVibes.length) summaryParts.push(allVibes[0]);

  const summary = summaryParts.join(', ') || 'Your personal style';

  console.log(`Analysis complete: ${allItems.length} items from ${allAnalyses.length} pins`);
  console.log('Top categories:', categoryBreakdown.slice(0, 3).map(c => `${c.name} (${c.count}x)`).join(', '));

  return {
    summary,
    style_vibe: allVibes[0] || 'minimal',
    dominant_colours: dominantColours,
    dominant_materials: dominantMaterials,
    dominant_categories: categoryBreakdown.slice(0, 5).map(c => c.name),
    category_breakdown: categoryBreakdown, // detailed breakdown per category
    search_terms: uniqueTerms,
    items: allItems,
    pins_analysed: allAnalyses.length,
  };
}
