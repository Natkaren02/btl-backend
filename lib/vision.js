const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function callOpenAI(messages) {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        max_tokens: 3000,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(45000),
    });
    const data = await res.json();
    if (data.error) { console.error('OpenAI error:', data.error.message); return null; }
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    console.error('OpenAI error:', err.message);
    return null;
  }
}

export async function analyseImage(imageUrl) {
  if (!imageUrl) return null;

  const response = await callOpenAI([{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
      { type: 'text', text: `You are an expert fashion analyst with a trained eye for garment construction. Analyse every visible item in this image with precision.

CRITICAL — READ BEFORE ANALYSING:

TOP TYPE — determine from shoulder and strap evidence ONLY:
- Look at the SHOULDER AREA. Is there fabric on the shoulder or bare skin?
- If bare shoulder AND hair covers the neck area → you CANNOT determine the top type. Use subcategory "fitted top" and add obscured_by: "neckline and strap type obscured by hair"
- If bare shoulder AND you can clearly see straps around the neck → HALTER TOP
- If bare shoulder AND no neck straps, neck clearly visible → STRAPLESS
- If fabric clearly covers the shoulder with straps visible → TANK TOP
- NEVER use "tank top" when the shoulders are bare. Tank tops have straps that sit ON the shoulder.
- When in doubt between halter and tank, look at whether the shoulder bone is covered by fabric or not.

JEANS/TROUSER CUT — look at the actual leg shape:
- Compare the width at thigh vs width at ankle
- WIDE LEG: leg opens wide from hip, roughly equal or wider at ankle than thigh
- BARREL/BAGGY: very wide through thigh and knee, may taper slightly at ankle but still roomy
- STRAIGHT: consistent moderate width from hip to ankle
- BOOTCUT: fitted through thigh, small flare at ankle (fits over boots)
- FLARE: fitted through thigh, dramatic flare from knee
- SLIM: fitted throughout, narrow ankle
- SKINNY: very tight throughout
Do NOT say "relaxed" or "wide" without specifying the cut. Be specific.

TROUSER LENGTH — reason from what you observe:
- If you can see the hem sitting on the floor or dragging → "floor length"
- If you can see the hem at the ankle with shoe visible → "ankle length"
- If the hem is not visible but the leg line and silhouette clearly continue to full length → "floor length (inferred from silhouette)"
- Only say "cropped" if you can CLEARLY see the hem ending above the ankle

MATERIAL — only identify if visually certain:
- Denim: textured woven fabric, matte, used for jeans
- Leather: structured, shiny surface that reflects light
- Suede: matte, slightly fuzzy, does not reflect light, softer looking than leather
- Knit: visible knit texture
- Silk/satin: very shiny, fluid
- If uncertain → omit material entirely

Return ONLY valid JSON:
{
  "items": [
    {
      "category": "tops|bottoms|dresses|outerwear|shoes|bags|accessories|jewellery|hats|scarves|belts|sunglasses",
      "subcategory": "precise e.g. halter top, wide leg jeans, suede fringe shoulder bag",
      "colour": "precise colour",
      "material": "only if certain: denim|leather|suede|knit|silk|satin|faux fur|canvas",
      "fit": "specific cut for bottoms: wide leg|barrel|straight|bootcut|flare|slim|skinny. For tops: fitted|oversized|cropped|boxy",
      "rise": "low rise|mid rise|high rise — only if waistband clearly visible",
      "length": "floor length|ankle length|midi|knee length|mini|cropped — only if determinable",
      "details": "visible specific details only e.g. fringe trim, gold hardware, raw hem, quilted panels",
      "obscured_by": "only include if something meaningfully obscures this item — describe specifically e.g. neckline hidden by hair, back of top not visible as photographed from behind. Do not write single words like bag or hair."
    }
  ],
  "outfit_formula": "e.g. black halter top + low rise wide leg black denim + black suede fringe shoulder bag",
  "overall_vibe": "2-3 word aesthetic based on the WHOLE outfit together, not one item e.g. 90s minimal, dark romantic, quiet luxury. A fringe bag alone does not make an outfit bohemian.",
  "proportions": "how the silhouette and proportions work together e.g. fitted top balanced by wide leg trouser, floor length fabric creates elongated silhouette"
}` }
    ]
  }]);

  if (!response) return null;

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('JSON parse error:', err.message);
    return null;
  }
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
