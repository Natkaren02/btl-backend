// vision.js — uses Claude to analyse Pinterest pin images
// Extracts precise fashion attributes for accurate product matching

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Analyse a single pin image and extract detailed fashion attributes
export async function analyseImage(imageUrl) {
  if (!imageUrl) return null;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'url', url: imageUrl },
            },
            {
              type: 'text',
              text: `Analyse this fashion image in precise detail. Return ONLY a JSON object with no other text:

{
  "items": [
    {
      "category": "one of: tops, bottoms, dresses, outerwear, shoes, bags, accessories, jewellery, hats, scarves, belts, sunglasses",
      "subcategory": "specific item e.g. jeans, blazer, midi dress, trench coat, loafers, tote bag",
      "colour": "precise colour e.g. indigo, cream, camel, forest green, chocolate brown",
      "material": "e.g. denim, silk, wool, leather, linen, cashmere, cotton",
      "fit": "e.g. wide leg, straight leg, slim, oversized, fitted, relaxed, cropped, maxi, midi, mini",
      "rise": "for bottoms only: low rise, mid rise, high rise",
      "details": "specific details e.g. raw hem, button front, ribbed, pleated, embroidered",
      "style_vibe": "e.g. 90s, minimalist, Scandinavian, vintage, elegant, casual, editorial"
    }
  ],
  "overall_vibe": "2-3 word description of the overall aesthetic",
  "search_terms": ["5-8 specific search terms to find similar items e.g. low rise indigo wide leg jeans, cream linen trousers"]
}`
            }
          ]
        }]
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    
    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Vision analysis error:', err.message);
    return null;
  }
}

// Analyse a whole board — find common patterns across all pins
export async function analyseBoard(pins) {
  // Take up to 12 pins with images
  const pinsWithImages = pins.filter(p => p.image).slice(0, 12);
  
  if (pinsWithImages.length === 0) {
    return { summary: 'No images to analyse', searchTerms: ['sustainable fashion'] };
  }

  try {
    // Build image content array for Claude
    const imageContent = [];
    for (const pin of pinsWithImages) {
      imageContent.push({
        type: 'image',
        source: { type: 'url', url: pin.image },
      });
    }
    imageContent.push({
      type: 'text',
      text: `These are ${pinsWithImages.length} Pinterest pins from a fashion board. Analyse them as a collection and identify the person's style preferences. Return ONLY a JSON object:

{
  "dominant_colours": ["top 3 colours that appear most across the pins"],
  "dominant_materials": ["top 3 materials"],
  "dominant_silhouettes": ["top 3 fits/silhouettes"],
  "dominant_categories": ["top 3 clothing categories they pin most"],
  "style_vibe": "2-4 word description e.g. minimal dark Scandinavian, 90s vintage casual",
  "search_terms": ["6-10 specific search terms to find similar sustainable products. Be very specific about fit and colour. e.g. low rise wide leg dark denim, cream oversized wool coat, black silk midi slip dress"],
  "summary": "One sentence describing this person's style in plain language"
}`
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: imageContent }],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { summary: 'Analysis failed', searchTerms: ['sustainable fashion'] };
    
    const analysis = JSON.parse(jsonMatch[0]);
    console.log('Board analysis:', analysis.summary);
    console.log('Search terms:', analysis.search_terms);
    return analysis;

  } catch (err) {
    console.error('Board analysis error:', err.message);
    return { summary: 'Analysis failed', searchTerms: ['sustainable fashion'] };
  }
}
