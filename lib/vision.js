// vision.js — uses Google Gemini to analyse Pinterest pin images
// Free tier at aistudio.google.com — no credit card needed
 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
 
async function callGemini(prompt, imageUrl = null) {
  const parts = [];
 
  if (imageUrl) {
    // Fetch image and convert to base64
    try {
      const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(10000) });
      const buffer = await imgRes.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
      parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
    } catch (err) {
      console.error('Failed to fetch image:', err.message);
      return null;
    }
  }
 
  parts.push({ text: prompt });
 
  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
      }),
    });
 
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Gemini error:', err.message);
    return null;
  }
}
 
// Analyse a single pin image — every outfit component
export async function analyseImage(imageUrl) {
  if (!imageUrl) return null;
 
  const prompt = `Analyse this fashion image in precise detail. Return ONLY a valid JSON object with no other text or markdown:
 
{
  "items": [
    {
      "category": "one of: tops, bottoms, dresses, outerwear, shoes, bags, accessories, jewellery, hats, scarves, belts, sunglasses",
      "subcategory": "specific item e.g. jeans, blazer, midi dress, trench coat, loafers, tote bag",
      "colour": "precise colour e.g. indigo, cream, camel, forest green, chocolate brown",
      "material": "e.g. denim, silk, wool, leather, linen, cashmere, cotton",
      "fit": "e.g. wide leg, straight leg, slim, oversized, fitted, relaxed, cropped, maxi, midi, mini",
      "rise": "for bottoms only: low rise, mid rise, high rise",
      "style_vibe": "e.g. 90s, minimalist, Scandinavian, vintage, elegant, casual"
    }
  ],
  "overall_vibe": "2-3 word description of the overall aesthetic",
  "search_terms": ["5-8 very specific search terms to find similar items e.g. low rise indigo wide leg jeans, cream oversized linen blazer"]
}`;
 
  return await callGemini(prompt, imageUrl);
}
 
// Analyse a whole board — find common patterns across multiple pin images
export async function analyseBoard(pins) {
  const pinsWithImages = pins.filter(p => p.image).slice(0, 6);
 
  if (pinsWithImages.length === 0) {
    return { summary: 'No images to analyse', search_terms: ['sustainable fashion'] };
  }
 
  // Analyse each image individually then combine
  const analyses = [];
  for (const pin of pinsWithImages) {
    const analysis = await analyseImage(pin.image);
    if (analysis) analyses.push(analysis);
  }
 
  if (analyses.length === 0) {
    return { summary: 'Could not analyse images', search_terms: ['sustainable fashion'] };
  }
 
  // Aggregate results across all analysed pins
  const allItems = analyses.flatMap(a => a.items || []);
  const allSearchTerms = analyses.flatMap(a => a.search_terms || []);
  const allVibes = analyses.map(a => a.overall_vibe).filter(Boolean);
 
  // Count most common categories, colours, materials
  const countMap = (items, key) => {
    const counts = {};
    for (const item of items) {
      const val = item[key];
      if (val) counts[val] = (counts[val] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  };
 
  const dominantColours = countMap(allItems, 'colour').slice(0, 3);
  const dominantMaterials = countMap(allItems, 'material').slice(0, 3);
  const dominantCategories = countMap(allItems, 'category').slice(0, 3);
  const dominantFits = countMap(allItems, 'fit').slice(0, 2);
 
  // Deduplicate search terms
  const uniqueTerms = [...new Set(allSearchTerms)].slice(0, 8);
 
  // Build summary
  const summaryParts = [];
  if (dominantColours.length) summaryParts.push(dominantColours.slice(0, 2).join(' and ') + ' tones');
  if (dominantMaterials.length) summaryParts.push(dominantMaterials.slice(0, 2).join(' and '));
  if (dominantFits.length) summaryParts.push(dominantFits[0] + ' silhouettes');
  if (allVibes.length) summaryParts.push(allVibes[0]);
 
  const summary = summaryParts.join(', ') || 'Your personal style';
  const styleVibe = allVibes[0] || 'minimal';
 
  console.log('Board analysis summary:', summary);
  console.log('Search terms:', uniqueTerms);
 
  return {
    summary,
    style_vibe: styleVibe,
    dominant_colours: dominantColours,
    dominant_materials: dominantMaterials,
    dominant_categories: dominantCategories,
    search_terms: uniqueTerms,
  };
}
