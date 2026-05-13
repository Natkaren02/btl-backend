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
      { type: 'text', text: `You are a precision fashion analyst. Your method is OBSERVE FIRST, NAME SECOND.

For every item: describe the physical construction you can see, then derive the name from that description. Never pattern-match to a category name without visual evidence.

TOPS:
- Shoulder area: is the shoulder bone covered by fabric or bare?
- If bare shoulder: look for neck straps (halter), shoulder straps (tank), thin straps (camisole), no straps (strapless)
- If hair covers neck: note "strap type obscured by hair", describe only what is visible
- Never write "tank top" if the shoulder bone is bare

BOTTOMS:
- Waistband: where does it sit — below hip bones (low rise), at hip bones (mid rise), above navel (high rise)
- Thigh width vs ankle width: equal and wide (wide leg), wide thigh tapering slightly (barrel/baggy), consistent moderate (straight), fitted thigh with slight ankle flare (bootcut), dramatic knee flare (flare), tight throughout (skinny)
- Hem position: floor, ankle, mid-calf (midi), knee, mid-thigh (mini)
- Construction details: visible stitching, raw hem, pressed crease, pleats, embroidery

OUTERWEAR:
- Collar: lapels (notch/peak/shawl), funnel/stand collar, hood, no collar
- Closure: belt (trench), double breasted buttons, single button, zip, open front
- Length: hip, knee, midi, floor
- Shoulders: structured/padded or relaxed/dropped
- Details: patch pockets, welt pockets, epaulettes, lining visible, cuffs
- Name from construction: belt + lapels = trench. No belt + funnel collar = car coat. Structured + lapels + hip length = blazer.

SHOES — observe construction carefully:
- Sole thickness: thin leather, chunky lug, platform, crepe
- Toe shape: round, almond, pointed, square, apron/moc toe (U-shaped stitched panel)
- Vamp: penny strap (horizontal strap), plain, buckle, laces
- Stitching: apron/moc stitching, contrast stitching, welt visible
- Heel: flat, block low, block mid, stiletto, wedge, platform
- Ankle height: flat, ankle strap, ankle boot, knee high, over knee
- Material: patent leather (mirror-like shine), smooth leather, suede, canvas
- Name from construction: chunky moc-toe penny loafer, pointed kitten heel mule, chelsea boot, etc.

BAGS — observe construction carefully:
- Shape: structured (holds shape), slouchy (soft), envelope, bucket, tote, hobo, half moon, barrel
- Size: mini, small, medium, large
- Handle: top handle (rigid), shoulder strap, long crossbody strap, chain strap, clutch (no handle), backpack straps
- Strap detail: leather strap, chain, adjustable, fixed length
- Hardware: gold, silver, antique brass, no hardware
- Closure: zip, flap with clasp, magnetic snap, open top, drawstring, turnlock
- Exterior details: quilting, stitching pattern, logo, fringe, studs, buckles, pockets
- Material: leather (shiny or matte aged), suede (matte with nap), canvas, woven

JEWELLERY AND ACCESSORIES:
- Describe shape, metal colour, stone if visible, style (chunky, delicate, geometric)

MATERIALS — general rules:
- Leather: structured surface, shiny (new) or matte (aged), grain visible, clean edges
- Suede: matte, directional nap/pile visible, slightly fuzzy, soft drape
- Patent leather: extremely high shine, almost mirror-like
- Aged leather vs suede: leather holds shape firmly, suede droops. When genuinely uncertain: write "leather or aged suede"
- Denim: woven cotton, matte, for jeans/jackets
- Knit: visible knit texture, ribbed or chunky
- Silk/satin: very shiny, fluid drape
- Never write "smooth fabric", "soft material" or similar vague descriptions

LENGTH:
- Floor length: hem on floor
- Ankle length: hem at ankle, shoe fully visible
- Midi: hem mid-calf
- Knee length: hem at knee
- Mini: hem mid-thigh or above
- Cropped: hem clearly above ankle but below knee
- Never add "(inferred)" or similar parenthetical notes

OVERALL VIBE: based on the whole outfit together. One statement piece does not define the vibe.

Return ONLY valid JSON:
{
  "items": [
    {
      "category": "tops|bottoms|dresses|outerwear|shoes|bags|accessories|jewellery|hats|scarves|belts|sunglasses",
      "subcategory": "name derived from construction e.g. car coat with funnel collar, wide leg tailored trousers, chunky moc-toe penny loafer, structured top handle bag",
      "colour": "precise colour",
      "material": "only if clearly identifiable",
      "fit": "shape: wide leg|barrel|straight|bootcut|flare|slim|skinny|oversized|fitted|boxy|relaxed|cropped",
      "rise": "low rise|mid rise|high rise — only if waistband clearly visible",
      "length": "floor length|ankle length|midi|knee length|mini|cropped",
      "details": "specific construction details visible e.g. apron toe stitching, penny strap, lug sole, funnel collar, button closure, fringe trim, gold turnlock, quilted panels",
      "obscured_by": "only if something meaningfully blocks view, describe specifically"
    }
  ],
  "outfit_formula": "precise combination e.g. black fitted top + low rise wide leg black denim + black leather fringe shoulder bag + chunky moc-toe loafers",
  "overall_vibe": "2-3 word aesthetic of the whole outfit",
  "proportions": "how silhouette and proportions work together"
}

Return ONLY the JSON. Nothing else.` }
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
