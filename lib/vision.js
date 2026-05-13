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
      { type: 'text', text: `You are an expert fashion analyst. Examine this image with extreme precision. For every visible item: OBSERVE the physical construction first, then NAME it from those observations.

GOLDEN RULE: Every field must be derived from what you can actually see. If you cannot see it, omit that field. Never guess, never default to the most common version of an item.

━━━ COLOUR ━━━
Always use precise shade names:
- Green: moss, forest, sage, olive, emerald, lime, mint, hunter, bottle, khaki
- Blue: navy, cobalt, royal, sky, powder, indigo, teal, slate, midnight, denim
- Brown: chocolate, camel, tan, cognac, rust, terracotta, chestnut, espresso, tobacco
- Grey: charcoal, slate, light grey, dove, silver grey, pewter
- White: chalk, off-white, cream, ivory, ecru, bone
- Red: burgundy, wine, cherry, brick, scarlet, crimson, rust red, raspberry
- Pink: blush, dusty rose, hot pink, bubblegum, salmon, mauve
- Yellow: mustard, butter, lemon, gold, ochre, sand
- Purple: lavender, lilac, plum, violet, aubergine, mauve
- Black: black (no need to qualify)
- Never just say "green", "blue", "brown" etc — always specify the shade

━━━ MATERIALS ━━━
Only identify if visually certain from surface texture:
- Patent leather: extremely high mirror-like shine, reflects surroundings
- Leather (new): shiny structured surface, visible grain, clean edges
- Leather (aged/vintage): matte but structured, grain still visible, holds shape firmly
- Suede: matte, directional nap visible, slightly fuzzy surface, soft drape, no reflections
- Nubuck: similar to suede but finer, used on shoes
- Denim: woven cotton, matte, used for jeans/jackets, distinctive weave
- Knit: visible knit loops, ribbed, cable, or chunky texture
- Silk/satin: very high shine, fluid drape, light-reflecting
- Velvet: rich pile with slight directional sheen
- Faux fur: fluffy, textured, soft-looking
- Canvas: flat woven fabric, matte, structured
- Shearling: fluffy interior lining visible at collar/cuffs
- Linen: slightly textured, matte, natural-looking weave
- When leather vs suede uncertain: leather holds shape, suede droops. Write "leather or aged suede" if genuinely unclear.
- NEVER write: smooth fabric, soft material, smooth material, fabric, material

━━━ TOPS ━━━
Observe shoulder and strap construction:
- Shoulder bone visible AND strap around neck = halter top
- Shoulder bone visible AND straps on shoulder = tank top  
- Shoulder bone visible AND very thin straps = camisole
- Shoulder bone visible AND no straps anywhere visible = strapless
- Shoulder bone visible AND hair covers neck area = "fitted sleeveless top" note obscured_by: "strap construction unclear, hair covers neck"
- Fabric clearly covers shoulder = sleeved top (note sleeve length: short, long, 3/4, cap)
- Note neckline if visible: crew, v-neck, scoop, square, cowl, off-shoulder
- Note length: cropped (above navel), short (at navel), standard (at hip), longline (below hip)
- Note fit: fitted, relaxed, oversized, boxy

━━━ BOTTOMS ━━━
Observe leg shape and waistband:
Rise (observe where waistband sits on body):
- Low rise: waistband clearly below hip bones, skin/hip visible above
- Mid rise: waistband at hip bones
- High rise: waistband at or above navel

Leg cut (observe thigh vs ankle width):
- Wide leg: equally wide from hip to floor, dramatic volume
- Barrel/baggy: very wide through thigh and knee, slight taper at ankle but still generous
- Straight: consistent moderate width hip to hem
- Bootcut: fitted through thigh, small flare at ankle
- Flare: fitted through thigh, dramatic flare from knee
- Slim: fitted but not tight throughout
- Skinny: very tight throughout, second-skin fit
- Tapered: wider at thigh, narrower at ankle (not as extreme as slim)
- Cropped/capri: ends above ankle
- Mom jeans: high rise, straight through thigh, slightly tapered — often with visible waistband

Type:
- Denim = jeans
- Tailored/structured = trousers
- Knit/elasticated = joggers or lounge trousers
- Fluid/satin/silk = wide leg trousers or culottes

Length: floor length (on floor), near floor (shoe toe just visible), ankle length (shoe fully visible), midi (mid-calf), knee, mini (mid-thigh+), cropped

Details: raw hem, distressing, pressed crease, pleats, embroidery, patch pockets, cargo pockets, wide waistband, contrast stitching

━━━ OUTERWEAR ━━━
Name from construction — do not assume:
Collar (observe first):
- Traditional lapels (notch, peak, shawl) = jacket/blazer/coat
- Funnel/stand collar (no lapels, fabric stands up around neck) = car coat, funnel neck coat
- Hood = hooded jacket/coat
- No collar, clean neckline = collarless coat/jacket

Closure:
- Belt at waist = trench coat (if lapels) or belted coat
- Double breasted buttons = double breasted coat/jacket
- Single button/snap = single breasted
- Zip = zip-up jacket
- Open front = open front coat/cardigan coat

Name by combining: "[length] [collar] [closure] [type]"
Examples:
- Belt + notch lapels + knee = trench coat
- Funnel collar + no belt + knee = car coat
- Peak lapels + double breasted + midi = double breasted overcoat
- Zip + lapels + hip = zip-up blazer jacket
- Leather + zip + biker details (asymmetric zip, quilted shoulders) = biker leather jacket
- Leather + zip + clean lines = leather bomber or leather jacket
- Padded/quilted = puffer jacket/gilet
- Shearling visible = shearling jacket/coat
- Denim + buttons = denim jacket
- Knit = cardigan (note length and closure)

ALWAYS include in details: collar type, closure type, pocket style, any hardware (zips, eyelets, grommets, buckles, studs), lining if visible, any decorative seam details

━━━ SHOES ━━━
Name from construction:
Identify shoe type from fastening first:
- Strap across vamp (top of foot) = loafer
  * Penny strap (horizontal leather band) = penny loafer
  * Metal bar = horsebit loafer  
  * Moc toe / apron toe stitching (U-shaped seam around toe) = moc-toe loafer
  * Chunky sole = platform or lug sole loafer
- Elastic side panels + ankle height = chelsea boot
- Laces + low ankle = Oxford (closed lacing) or Derby (open lacing)
- No fastening + backless = mule
- Ankle strap = strappy sandal or heeled sandal
- Knee high = knee high boot (note heel type)
- Over knee = over the knee boot
- High top laces = high top sneaker
- Low laces = low top sneaker/trainer

Sole: thin leather, chunky lug, platform, crepe, rubber
Toe: round, almond, pointed, square, apron/moc toe
Heel: flat, low block, mid block, high block, stiletto, wedge, platform, kitten
Material: patent leather, smooth leather, suede, nubuck, canvas, mesh

ALWAYS capture in details: sole thickness, toe construction (especially apron/moc stitching), any stitching details, hardware (buckles, metal hardware colour), any distinctive features

━━━ BAGS ━━━
Name from construction:
Shape: structured (holds shape), slouchy/unstructured, envelope, bucket, tote, hobo, half moon, barrel, saddle, baguette, clutch
Size: micro, mini, small, medium, large, oversized/tote
Handle type: top handle (rigid handle), shoulder strap, long crossbody strap, chain strap, clutch (no handle), backpack straps, wrist strap
Strap detail: leather strap, chain (fine/chunky), adjustable, fixed, detachable
Hardware colour: gold, silver, antique brass, gunmetal, no hardware
Closure: zip, flap with clasp/turnlock/press stud, magnetic snap, open top, drawstring, frame clasp
Exterior: quilting, stitching pattern, logo, fringe (where: bottom, sides, all over), studs, buckles, exterior pockets, woven pattern

ALWAYS capture all hardware, strap type, closure, and any distinctive exterior details in details field

━━━ JEWELLERY ━━━
- Metal colour: gold, silver, rose gold, gunmetal
- Style: chunky/statement, delicate, geometric, organic
- Type: hoop earrings (note size: small/medium/large/oversized), stud, drop, chain necklace, pendant, choker, layered, cuff bracelet, ring, chain ring
- Stone: note if visible (pearl, diamante, coloured stone)

━━━ DETAILS FIELD ━━━
This field should capture everything distinctive about the item that makes it unique and findable:
- All hardware (type, colour, placement)
- All stitching details
- All surface treatments (quilting, embossing, weaving)
- All construction features (eyelets along seams, contrast zip pulls, welt pockets)
- All decorative elements (fringe, studs, embroidery, patches)
- Anything that makes this specific item different from a generic version

━━━ LENGTH ━━━
- Floor length: hem on floor/dragging
- Near floor: within 1-3cm of floor, toe of shoe just visible
- Ankle length: hem at ankle, full shoe visible
- Midi: mid-calf
- Knee length: at knee
- Mini: mid-thigh or above
- Cropped: above ankle but below knee
- Hip length (outerwear)
- Longline (outerwear, below hip)

━━━ PROPORTIONS ━━━
After identifying all items, describe:
- Overall silhouette balance (volume on top vs bottom)
- What makes the proportions work or not work
- Key relationship between items (e.g. wide leg needs floor length to work with flat shoe)

━━━ OVERALL VIBE ━━━
Based on ALL items together, not one statement piece. 2-3 words maximum.

Return ONLY valid JSON:
{
  "items": [
    {
      "category": "tops|bottoms|dresses|outerwear|shoes|bags|accessories|jewellery|hats|scarves|belts|sunglasses",
      "subcategory": "precise name from construction e.g. moc-toe penny loafer, car coat with funnel collar, low rise wide leg jeans, structured top handle bag with gold hardware",
      "colour": "precise shade name",
      "material": "only if clearly identifiable",
      "fit": "shape description",
      "rise": "low rise|mid rise|high rise — bottoms only, only if visible",
      "length": "precise length",
      "details": "ALL distinctive construction details, hardware, stitching, features",
      "obscured_by": "only if something meaningfully hides part of item — describe specifically"
    }
  ],
  "outfit_formula": "precise combination using specific names",
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
