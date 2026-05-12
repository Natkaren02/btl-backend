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

  const prompt = `You are a precision fashion analyst. Your ONLY job is to identify what you can CLEARLY SEE.

CRITICAL RULES — read these carefully:
1. NEVER GUESS. If you cannot clearly identify something, OMIT that field entirely from the JSON. Do not write null, do not write "unclear", just leave the field out.
2. Material: ONLY include if the texture is clearly visible. Denim looks like denim. Leather is shiny or matte with visible grain. Knit shows individual stitches. Silk drapes in a specific way. If you cannot tell — OMIT.
3. Rise: ONLY include for bottoms AND ONLY if you can clearly see where the waistband sits relative to the hips/navel. If the image is cropped or unclear — OMIT.
4. Break (how trousers hit the shoe): Include as an INTERNAL field only — never show this to the user. Use it only in search_query.
5. Category-specific fields ONLY:
   - heel, toe: ONLY for shoes
   - rise, break: ONLY for trousers/jeans/skirts
   - strap_type, hardware, closure: ONLY for bags
   - collar: ONLY for tops, dresses, outerwear
6. Colour: state exactly what you see. "Black" if black. "Dark indigo" if dark indigo denim. "Camel" if camel. Not "midnight obsidian black" — just "black".
7. subcategory must be the actual item type: "wide leg jeans", "structured tote bag", "ankle boot", "oversized wool coat". NOT "bottom piece" or "footwear".

Identify EVERY visible item: clothing, shoes, bags, jewellery, belts, scarves, hats, sunglasses, accessories.

For BOTTOMS specifically:
- Jeans: note the wash (dark indigo, light wash, black, white), leg shape (wide leg, straight, bootcut, skinny, flared), and rise ONLY if clearly visible
- Trousers: note the fabric drape, leg width, length (ankle, floor with break, midi, cropped)
- Skirts: note length (mini, midi, maxi, knee) and silhouette (A-line, pencil, wrap, tiered)

For BAGS specifically:
- Note: size (mini/small/medium/large), shape (structured/slouchy/bucket/tote/clutch/hobo), handle type (top handle/shoulder/crossbody/clutch), hardware colour if visible, any distinctive details (fringe, quilting, chain, studs, logo)

For SHOES specifically:
- Note: heel height (flat/low/mid/high), toe shape (round/almond/pointed/square), style (loafer/boot/sandal/sneaker/pump/mule), ankle height, any closure

After identifying items, assess overall proportions and what makes this outfit formula work.

Return ONLY valid JSON — omit any field you cannot clearly determine:
{
  "items": [
    {
      "category": "tops|bottoms|dresses|outerwear|shoes|bags|accessories|jewellery|hats|scarves|belts|sunglasses",
      "subcategory": "exact item name e.g. wide leg dark indigo jeans, structured black leather top handle bag, oversized camel wool coat",
      "colour": "exact colour you can see",
      "material": "only if clearly visible from texture",
      "fit": "only for clothing — e.g. wide leg, straight, oversized, fitted, relaxed",
      "rise": "low rise|mid rise|high rise — ONLY for bottoms AND only if clearly visible",
      "length": "where it hits on the body — only if relevant and visible",
      "break": "no break|slight break|full break — ONLY for trousers, internal use only",
      "heel": "flat|low|mid|high — ONLY for shoes",
      "toe": "round|almond|pointed|square — ONLY for shoes",
      "strap_type": "top handle|shoulder|crossbody|clutch — ONLY for bags",
      "hardware": "gold|silver|antique|none — ONLY for bags if visible",
      "closure": "ONLY for bags or outerwear if clearly visible",
      "details": "only genuinely distinctive details you can clearly see e.g. fringe trim, raw hem, quilted leather, chain strap, fur collar",
      "style_vibe": "2-3 words e.g. 90s minimal, quiet luxury, dark academia",
      "search_query": "specific search terms to find this exact item, incorporating all visible attributes"
    }
  ],
  "outfit_formula": "the core outfit formula e.g. oversized knit + wide leg jeans + loafer",
  "proportions": "how the proportions work together",
  "overall_vibe": "2-4 word aesthetic description",
  "balance_notes": "what makes the silhouette work or not work"
}`;

  return await callOpenAI(prompt, imageUrl);
}

export async function generateFormulaImage(formula, colours, vibe) {
  if (!OPENAI_API_KEY) return null;
  const prompt = `Fashion flat lay illustration on white background. Clothing items laid flat: ${formula}. Colour palette: ${colours.join(', ')}. Style: ${vibe}. Minimalist editorial. No text, no people, no mannequins.`;
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', quality: 'standard' }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json();
    return data.data?.[0]?.url || null;
  } catch (err) {
    console.error('DALL-E error:', err.message);
    return null;
  }
}

export async function analyseBoard(pins) {
  const pinsWithImages = pins.filter(p => p.image);
  return { pinsWithImages, total: pinsWithImages.length };
}
