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

  const prompt = `You are a fashion analyst. Look at this image and identify every visible clothing item, shoe, bag, and accessory.

STRICT RULES:
1. Only include fields you can CLEARLY SEE. If you cannot tell, leave that field out. Never guess.
2. Material: only include if the texture is clearly identifiable. Denim looks like denim. Leather looks like leather. Suede looks like suede. If genuinely unclear, omit the material field entirely.
3. Rise: low rise sits below the hip bones. Mid rise at the hip bones. High rise above the navel. Only include if you can clearly see where the waistband sits on the body.
4. Colour: simple accurate names only. Black, white, indigo, camel, brown, grey, cream, burgundy, navy, beige. Never describe texture as a colour.
5. For jeans specifically: the material is always denim. Describe the wash (black denim, indigo denim, light wash denim, raw denim). Never say smooth fabric for jeans.
6. If an item is cut off or obscured, only describe what you can actually see.

For each visible item return only the fields you can clearly determine:

{
  "items": [
    {
      "category": "bottoms | tops | dresses | outerwear | shoes | bags | accessories | jewellery | hats | scarves | belts | sunglasses",
      "subcategory": "specific item e.g. wide leg jeans, oversized blazer, ankle boots, shoulder bag",
      "colour": "actual colour you can see",
      "material": "only if clearly visible: denim, leather, suede, cotton knit, silk, wool, linen, faux fur",
      "fit": "e.g. wide leg, straight, bootcut, slim, oversized, fitted, relaxed, boxy, cropped",
      "rise": "low rise | mid rise | high rise — only if clearly visible",
      "length": "where it ends on the body — only if clearly visible",
      "details": "specific visible details only e.g. raw hem, fringe, gold hardware, chain strap, fur collar, quilted",
      "search_query": "specific search phrase for this exact item e.g. low rise wide leg indigo jeans raw hem"
    }
  ],
  "outfit_formula": "the combination e.g. fitted black halter + low rise wide leg indigo jeans + black suede fringe bag",
  "overall_vibe": "2-3 word aesthetic e.g. 90s minimal, quiet luxury, dark romantic",
  "proportions": "how the proportions work e.g. fitted top balances wide leg trouser, floor length break essential with this shoe",
  "balance_notes": "what makes this work or what to watch out for proportionally"
}

Return ONLY the JSON object, nothing else.`;

  return await callOpenAI(prompt, imageUrl);
}

export async function analyseBoard(pins) {
  const pinsWithImages = pins.filter(p => p.image);
  return { pinsWithImages, total: pinsWithImages.length };
}

export async function generateFormulaImage(formula, colours, vibe) {
  if (!OPENAI_API_KEY) return null;
  const prompt = `Fashion flat lay illustration on white background. Items arranged neatly: ${formula}. Colour palette: ${colours.join(', ')}. Style: ${vibe}. Minimalist editorial style. No people, no text, no mannequins. Clean white background.`;
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
