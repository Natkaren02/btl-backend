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
        max_tokens: 4096,
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
      { type: 'text', text: `You are a precision fashion analyst. Systematically identify every visible item in this image.

For each item: describe what you physically observe, then derive the name. Never guess — if you cannot see it clearly, omit that field.

━━━ PROCESS ━━━
1. Scan the full image and list every item visible (clothing, shoes, bags, jewellery, accessories, headwear)
2. For each item, observe construction details before naming
3. Output JSON

━━━ TOPS ━━━
Look at the shoulder area:
- Shoulder bone bare + strap around neck = halter top
- Shoulder bone bare + straps on shoulder = tank top
- Shoulder bone bare + thin straps = camisole
- Shoulder bone bare + no straps visible = strapless top
- Shoulder bone bare + hair covers neck = sleeveless top (add obscured_by: "strap construction unclear, hair covers neck/back")
- Fabric covers shoulder bone = sleeved top (note sleeve length)
- Also note: neckline shape, fit, length (cropped/standard/longline)

━━━ BOTTOMS ━━━
Rise — observe waistband position:
- Clearly below hip bones = low rise
- At hip bones = mid rise  
- At or above navel = high rise
- Not visible = omit

Leg cut — compare thigh width to ankle width:
- Wide equally hip to floor = wide leg
- Very wide thigh/knee, slight ankle taper but still generous = barrel/baggy
- Consistent moderate width = straight
- Fitted thigh, small ankle flare = bootcut
- Fitted thigh, dramatic knee-down flare = flare
- Fitted throughout, narrow ankle = slim
- Very tight throughout = skinny
- High rise, straight thigh, slight ankle taper = mom jeans

Type: denim construction = jeans. Tailored/structured = trousers. Knit/elasticated = joggers.

Length — observe where hem sits:
- On floor or dragging = floor length
- Shoe toe barely visible below hem = near floor length
- Hem at ankle, full shoe visible = ankle length
- Hem mid-calf = midi
- Hem at knee = knee length
- Hem mid-thigh or above = mini
- Hem above ankle but below knee = cropped

Details: raw hem, pressed crease, pleats, distressing, wide waistband, contrast stitching, embroidery

━━━ OUTERWEAR ━━━
Step 1 — describe collar: traditional lapels (notch/peak/shawl), funnel collar (fabric stands around neck), stand collar, convertible strap (strap near collar allowing funnel or open wear), hood, no collar
Step 2 — describe closure: belt at waist, double breasted, single breasted, zip, open front
Step 3 — describe length: hip length, knee length, midi, floor length
Step 4 — name from steps 1-3:
- Belt + lapels = trench coat
- Funnel collar OR convertible collar strap + no belt = car coat
- Double breasted + longline = overcoat  
- Structured + lapels + hip = blazer
- Zip + leather + biker details = biker jacket
- Zip + clean lines + hip = bomber jacket
- Padded/quilted = puffer jacket
- Shearling lining visible = shearling jacket/coat
- Denim + buttons = denim jacket
- Any other: "[length] [collar description] coat"

ALWAYS note in details: collar type, closure, pocket style, hardware (zips, eyelets, grommets, studs, buttons), any distinctive seam or design features

━━━ SHOES ━━━
Step 1 — identify fastening: strap across vamp top = loafer. Elastic side panels = chelsea boot. Laces = oxford/derby. No fastening, backless = mule. Ankle strap = sandal. High shaft = boot.
Step 2 — observe sole: thin leather, chunky lug, platform, crepe
Step 3 — observe toe: round, almond, pointed, square, apron/moc toe (U-shaped stitched seam around toe)
Step 4 — observe vamp details: penny strap (horizontal leather strap), plain, horsebit (metal bar), buckle
Step 5 — observe stitching: apron stitching (U-shaped seam), contrast stitching, welt
Step 6 — observe material: patent leather (mirror-like shine), smooth leather, suede, nubuck, canvas
Step 7 — name: chunky lug moc-toe penny loafer, patent leather apron-toe loafer, chelsea boot, pointed toe kitten heel mule, etc.

ALWAYS capture in details: sole type, toe construction, any stitching, vamp detail, hardware

━━━ BAGS ━━━
Observe: shape (structured/slouchy/envelope/bucket/tote/hobo/half moon/barrel/saddle/baguette), size (micro/mini/small/medium/large), handle (top handle/shoulder strap/long crossbody/chain/clutch/backpack), strap detail (leather/chain/adjustable/fixed), hardware colour (gold/silver/antique/gunmetal), closure (zip/flap clasp/turnlock/magnetic/open top), exterior (quilted/fringe/studs/woven/embroidered/logo)

━━━ JEWELLERY ━━━
Metal colour, style (chunky/delicate/geometric), type (hoop earring size, stud, drop, chain necklace, pendant, choker, cuff, ring), stone if visible

━━━ HEADWEAR/SCARVES ━━━
Describe how it is worn, material if visible, colour, style

━━━ COLOUR — always precise ━━━
Never use generic colour names. Always specify shade:
- Beige family: warm beige, cool beige, ecru, cream, ivory, bone, stone, sand, camel
- Green: moss, forest, sage, olive, emerald, hunter, bottle, khaki, lime, mint
- Blue: navy, cobalt, royal, sky, powder, indigo, teal, slate, midnight
- Brown: chocolate, cognac, tan, rust, terracotta, chestnut, espresso, tobacco
- Grey: charcoal, slate, dove, light grey, pewter, silver grey
- Red: burgundy, wine, cherry, brick, scarlet, crimson, rust red
- Pink: blush, dusty rose, hot pink, bubblegum, salmon, mauve
- Yellow: mustard, butter, lemon, gold, ochre
- Purple: lavender, lilac, plum, violet, aubergine
- White: chalk white, off-white, cream, ivory, ecru (white = pure white only)
- Black: black

━━━ MATERIALS ━━━
Patent leather = mirror-like shine. Leather (new) = shiny, structured, grain visible. Leather (aged) = matte but structured, holds shape. Suede = matte, directional nap, slightly fuzzy, soft drape. When uncertain: "leather or aged suede". Denim = woven cotton, matte. Knit = visible knit texture. Silk/satin = very shiny, fluid. Velvet = pile with directional sheen. Faux fur = fluffy. Canvas = flat woven matte. Shearling = fluffy interior visible. Linen = textured natural weave. If unsure = omit.
NEVER write: smooth fabric, soft material, smooth material, fabric, material, not clearly identifiable

━━━ DETAILS FIELD ━━━
Capture every distinctive feature: all hardware (type, colour, placement), stitching details, construction features (eyelets along seams, convertible collar straps, welt pockets, cargo pockets), decorative elements (fringe, studs, embroidery, quilting), anything making this item unique and findable. If there are silver eyelets along a side seam, write that. If there is a convertible collar strap, write that.

━━━ OBSCURED ITEMS ━━━
Always include partially visible items — partial information is better than nothing. Describe what IS visible. Use obscured_by to note what you cannot see (e.g. "back of top not visible, photographed from behind", "neckline hidden by hair").

━━━ OVERALL VIBE ━━━
Based on all items together. One statement piece does not define the aesthetic.

Return ONLY valid JSON:
{
  "items": [
    {
      "category": "tops|bottoms|dresses|outerwear|shoes|bags|accessories|jewellery|hats|scarves|belts|sunglasses",
      "subcategory": "precise name from construction e.g. car coat with convertible collar strap, wide leg tailored trousers, chunky moc-toe penny loafer, structured top handle bag",
      "colour": "precise shade",
      "material": "only if clearly identifiable",
      "fit": "precise shape description",
      "rise": "low rise|mid rise|high rise — only if waistband visible",
      "length": "floor length|near floor length|ankle length|midi|knee length|mini|cropped|hip length",
      "details": "ALL distinctive construction details and features visible",
      "obscured_by": "only if something meaningfully hides part of item"
    }
  ],
  "outfit_formula": "precise combination using specific subcategory names",
  "overall_vibe": "2-3 word aesthetic of whole outfit",
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
