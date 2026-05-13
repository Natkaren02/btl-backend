// vision.js — OpenAI GPT-4o-mini precision fashion analysis

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function callOpenAI(prompt, imageUrl = null) {
  const content = imageUrl ? [
    { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
    { type: 'text', text: prompt }
  ] : [{ type: 'text', text: prompt }];

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content }],
        max_tokens: 2048,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (data.error) { console.error('OpenAI error:', data.error.message); return null; }
    const text = data.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('OpenAI error:', err.message);
    return null;
  }
}

export async function analyseImage(imageUrl) {
  if (!imageUrl) return null;

  const prompt = `You are a fashion analyst. Your job is to identify clothing items in this image with precision.

ABSOLUTE RULES — follow these exactly:

RULE 1 — NEVER GUESS. If you cannot clearly see something, do not include that field. A missing field is always better than a wrong one.

RULE 2 — MATERIALS. These materials are visually obvious and you CAN identify them:
- Denim: has a distinctive woven texture, usually used for jeans
- Leather: shiny, structured, reflects light, used for bags, jackets, shoes, skirts
- Suede: matte, soft-looking, slightly fuzzy texture, used for bags, shoes, jackets
- Canvas: flat woven fabric, used for bags, jackets
- Knit/knitwear: visible knit texture, ribbed or chunky
- Silk/satin: very shiny, fluid, light-reflecting
- Faux fur: fluffy, textured
- Velvet: rich, slightly shiny pile fabric
If you cannot identify the material from this list, DO NOT include a material field. NEVER write "smooth fabric", "soft material", "smooth material" or similar vague descriptions — these are not materials.

RULE 3 — TROUSER/SKIRT LENGTH. Describe exactly what you can see:
- "touches the floor" if hem reaches the floor
- "ankle length" if hem is at the ankle
- "midi" if hem is mid-calf
- "knee length" if hem is at the knee
- "mini" if hem is at mid-thigh or above
- "cropped" if hem is above the ankle but below the knee
Do not estimate centimetres unless you can clearly measure against a reference point in the image.

RULE 4 — PARTIALLY OBSCURED ITEMS. If hair, another person, or another item covers part of a garment:
- Only describe what you can actually see
- Note what is obscured e.g. "neckline obscured by hair"
- Do not guess what is hidden

RULE 5 — RISE. Only include rise if you can clearly see where the waistband sits:
- Low rise: waistband sits visibly below the hip bones
- Mid rise: waistband sits at the hip bones
- High rise: waistband sits above the navel
If the waistband is not clearly visible, do not include rise.

RULE 6 — TOPS. Describe the neckline and sleeve style only if clearly visible. If hair covers the neckline, say "neckline obscured". Never guess between halter, tank, or camisole if you cannot clearly see the shoulder and neckline construction.

For each clearly visible item, return only the fields you can determine with confidence:

{
  "items": [
    {
      "category": "bottoms | tops | dresses | outerwear | shoes | bags | accessories | jewellery | hats | scarves | belts | sunglasses",
      "subcategory": "specific item type e.g. wide leg jeans, shoulder bag, ankle boots",
      "colour": "colour you can clearly see e.g. black, indigo, camel, cream, burgundy",
      "material": "ONLY from this list if clearly visible: denim | leather | suede | canvas | knit | silk | satin | faux fur | velvet",
      "fit": "e.g. wide leg, straight, slim, oversized, fitted, relaxed, boxy, cropped",
      "rise": "low rise | mid rise | high rise — ONLY if waistband is clearly visible",
      "length": "touches the floor | ankle length | cropped | knee length | midi | mini — ONLY if clearly visible",
      "details": "specific visible details e.g. raw hem, fringe, gold hardware, chain strap, quilted, fur collar — ONLY what you can clearly see",
      "neckline": "crew | v-neck | turtleneck | halter | off-shoulder | strapless — ONLY if clearly visible",
      "obscured_by": "note if any part is hidden e.g. neckline obscured by hair"
    }
  ],
  "outfit_formula": "the combination of items e.g. sleeveless fitted top + low rise wide leg black jeans + black suede fringe bag",
  "overall_vibe": "2-3 word aesthetic e.g. 90s minimal, quiet luxury, dark romantic",
  "proportions": "how the proportions and silhouette work together",
  "search_queries": {
    "describe each item with a search query": "e.g. low rise wide leg black denim jeans, black suede fringe shoulder bag"
  }
}

Return ONLY valid JSON. Nothing else.`;

  return await callOpenAI(prompt, imageUrl);
}

export async function analyseBoard(pins) {
  const pinsWithImages = pins.filter(p => p.image);
  return { pinsWithImages, total: pinsWithImages.length };
}

export async function generateFormulaImage(formula, colours, vibe) {
  if (!OPENAI_API_KEY) return null;
  const prompt = `Fashion flat lay illustration on clean white background. Items arranged neatly: ${formula}. Colour palette: ${colours.join(', ')}. Aesthetic: ${vibe}. Minimalist editorial style. No people, no text, no mannequins. Just the clothing items flat laid on white.`;
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json();
    return data.data?.[0]?.url || null;
  } catch (err) {
    console.error('DALL-E error:', err.message);
    return null;
  }
}
