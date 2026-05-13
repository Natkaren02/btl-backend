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

  const prompt = `You are a fashion analyst. Look at this image carefully and use visual reasoning — not guessing — to identify every item.

KEY REASONING RULES:

TOPS — identify from what you can actually see on the body:
- Can you see bare shoulders with NO fabric at all on the shoulder? → likely halter (straps go around neck) or strapless. Look for neck straps to distinguish.
- Can you see fabric on the shoulder but bare arm? → tank top (has shoulder straps) or short sleeve
- Can you see straps going around the neck? → halter top
- Can you see thin spaghetti straps at shoulder? → camisole
- Is the shoulder completely covered with sleeve? → sleeved top, note sleeve length
- Only say "sleeveless top" if you genuinely cannot determine the strap/neckline style from any visible evidence

JEANS AND TROUSERS — be specific about the leg shape:
- Wide leg: same width from hip to hem, very wide at ankle
- Barrel/baggy: wide through thigh and knee, tapers slightly at ankle but still wide
- Mom jeans: high rise, straight through thigh, slightly tapered at ankle
- Bootcut: fitted through thigh, slight flare at ankle (designed for boots)
- Flare: fitted through thigh, dramatic flare from knee down
- Straight leg: consistent width from hip to hem, not wide
- Slim: fitted through thigh and calf, narrow at ankle
- Skinny: very fitted throughout, tight at ankle
Look at the relationship between thigh width and ankle width to determine the cut.

TROUSER LENGTH — look at the hem relative to the shoe:
- Floor length: hem touches or drags on the floor
- Ankle length: hem sits at the ankle, shoe is fully visible
- If bottom of trousers not visible in image, do not include length

RISE — look at where waistband sits:
- Low rise: waistband sits below the hip bones, you can see hip/skin above the waistband
- Mid rise: waistband sits at the hip bones
- High rise: waistband sits at or above the navel
Only include if you can clearly see the waistband position.

MATERIALS — only from this list if visually obvious:
- Denim: for jeans, woven cotton with distinctive texture
- Leather: shiny, structured, reflects light clearly
- Suede: matte, slightly fuzzy, does not reflect light
- Knit: visible knit texture, ribbed or chunky
- Silk/satin: very shiny, fluid drape
- Faux fur: obviously fluffy texture
- Canvas: flat woven fabric, matte
If material is not clearly identifiable, do not include it.

Return ONLY valid JSON:
{
  "items": [
    {
      "category": "tops|bottoms|dresses|outerwear|shoes|bags|accessories|jewellery|hats|scarves|belts|sunglasses",
      "subcategory": "specific e.g. halter top, wide leg jeans, barrel jeans, bootcut jeans, shoulder bag — be precise",
      "colour": "colour you can clearly see",
      "material": "only if clearly identifiable from the list above",
      "fit": "specific leg/body shape — for jeans: wide leg|barrel|mom|bootcut|flare|straight|slim|skinny",
      "rise": "low rise|mid rise|high rise — only if waistband clearly visible",
      "length": "floor length|ankle length|midi|knee length|mini|cropped — only if hem visible",
      "details": "specific visible details only e.g. fringe, gold hardware, raw hem, quilted, chain strap",
      "obscured_by": "note if any part is hidden"
    }
  ],
  "outfit_formula": "precise combination e.g. halter top + low rise wide leg black denim + black suede fringe bag",
  "overall_vibe": "2-3 word aesthetic",
  "proportions": "how the silhouette and proportions work"
}

Return ONLY the JSON. Nothing else.`;

  return await callOpenAI(prompt, imageUrl);
}

export async function analyseBoard(pins) {
  const pinsWithImages = pins.filter(p => p.image);
  return { pinsWithImages, total: pinsWithImages.length };
}

export async function generateFormulaImage(formula, colours, vibe) {
  if (!OPENAI_API_KEY) return null;
  const prompt = `Fashion flat lay illustration on clean white background. Items: ${formula}. Colours: ${colours.join(', ')}. Style: ${vibe}. Minimalist editorial. No people, no text, no mannequins.`;
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
