// vision.js — uses Google Gemini to analyse Pinterest pin images

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

async function imageToBase64(imageUrl) {
  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BeyondTheLabel/1.0)',
        'Referer': 'https://www.pinterest.com/',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.log(`Image fetch failed: ${res.status} for ${imageUrl}`);
      return null;
    }
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    return { base64, mimeType };
  } catch (err) {
    console.log(`Image fetch error: ${err.message}`);
    return null;
  }
}

async function callGemini(prompt, imageBase64 = null, mimeType = 'image/jpeg') {
  const parts = [];

  if (imageBase64) {
    parts.push({ inline_data: { mime_type: mimeType, data: imageBase64 } });
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
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();

    if (data.error) {
      console.error('Gemini API error:', data.error.message);
      return null;
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('Gemini response:', text.substring(0, 200));

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('No JSON found in Gemini response');
      return null;
    }
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Gemini call error:', err.message);
    return null;
  }
}

export async function analyseImage(imageUrl) {
  if (!imageUrl) return null;

  console.log(`Analysing image: ${imageUrl.substring(0, 80)}`);
  const img = await imageToBase64(imageUrl);
  if (!img) return null;

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
  "search_terms": ["5-8 very specific search terms to find similar items e.g. low rise indigo wide leg jeans, cream oversized wool coat"]
}`;

  return await callGemini(prompt, img.base64, img.mimeType);
}

export async function analyseBoard(pins) {
  const pinsWithImages = pins.filter(p => p.image).slice(0, 6);

  if (pinsWithImages.length === 0) {
    return { summary: 'No images to analyse', search_terms: ['sustainable fashion'] };
  }

  console.log(`Analysing ${pinsWithImages.length} pin images with Gemini...`);

  const analyses = [];
  for (const pin of pinsWithImages) {
    const analysis = await analyseImage(pin.image);
    if (analysis) {
      analyses.push(analysis);
      console.log(`Pin analysed: ${analysis.overall_vibe}`);
    }
  }

  if (analyses.length === 0) {
    return { summary: 'Could not analyse images', search_terms: ['sustainable fashion'] };
  }

  const allItems = analyses.flatMap(a => a.items || []);
  const allSearchTerms = analyses.flatMap(a => a.search_terms || []);
  const allVibes = analyses.map(a => a.overall_vibe).filter(Boolean);

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

  const uniqueTerms = [...new Set(allSearchTerms)].slice(0, 8);

  const summaryParts = [];
  if (dominantColours.length) summaryParts.push(dominantColours.slice(0, 2).join(' and ') + ' tones');
  if (dominantMaterials.length) summaryParts.push(dominantMaterials.slice(0, 2).join(' and '));
  if (allVibes.length) summaryParts.push(allVibes[0]);

  const summary = summaryParts.join(', ') || 'Your personal style';

  console.log('Final analysis:', summary);
  console.log('Search terms:', uniqueTerms);

  return {
    summary,
    style_vibe: allVibes[0] || 'minimal',
    dominant_colours: dominantColours,
    dominant_materials: dominantMaterials,
    dominant_categories: dominantCategories,
    search_terms: uniqueTerms,
  };
}
