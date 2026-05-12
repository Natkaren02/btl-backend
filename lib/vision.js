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

// Single pin analysis — maximum precision, every item, proportions considered
export async function analyseImage(imageUrl) {
  if (!imageUrl) return null;

  const prompt = `You are a precision fashion analyst and stylist. Examine this image with extreme care.

Identify EVERY visible item including clothing, shoes, bags, jewellery, accessories, belts, scarves, hats, sunglasses.

For EACH item be extremely specific:

BOTTOMS (jeans, trousers, skirts):
- Rise: exactly where waistband sits (low rise = below hip bones, mid rise = at hip bones, high rise = above navel)
- Leg width: at thigh AND ankle (e.g. wide at thigh, wide at ankle = wide leg; wide at thigh, narrow at ankle = tapered)
- Length: where hem hits (ankle, floor with break, floor dragging, cropped above ankle, knee, midi, mini)
- Break: how much fabric pools at shoe (no break, slight break, full break, heavy break)
- Waistband: visible waistband width and type
- Details: distressing, raw hem, pressed crease, pleats, embroidery

TOPS/KNITWEAR:
- Exact silhouette (boxy, oversized with drop shoulder, fitted, cropped)
- Neckline type (crew, v-neck, turtleneck, mock neck, off shoulder, wide neck)
- Sleeve length and width
- Length (hits at hip, waist, above navel)
- Texture/knit type (chunky cable, fine rib, smooth, brushed)

OUTERWEAR:
- Length precisely (cropped, hip, knee, midi, maxi, floor)
- Closure (belted, double breasted, single button, open front, zip)
- Lapel type (notch, peak, shawl, no lapel)
- Shoulder (structured, relaxed, dropped)
- Details (fur trim, epaulettes, patch pockets, belt loops)

SHOES:
- Heel height (flat, block low, block mid, stiletto, wedge)
- Toe shape (round, almond, pointed, square)
- Ankle height (flat, ankle strap, ankle boot, knee high, over knee)
- Sole thickness
- Details (buckle, loafer penny, chelsea elastic, lace up)

BAGS:
- Size (mini, small, medium, large, oversized)
- Shape (structured, slouchy, envelope, bucket, hobo, tote, half moon)
- Handle type (top handle, shoulder strap, crossbody long strap, clutch no handle, backpack)
- Strap details (chain, leather, adjustable, fixed)
- Hardware colour (gold, silver, antique brass, none)
- Closure (zip, flap with clasp, open top, drawstring, magnetic)
- Details (quilting, stitching, logo, fringe, studs)

PROPORTIONS AND BALANCE:
After listing items, assess the overall outfit balance:
- Is the silhouette top-heavy or bottom-heavy?
- Do the proportions work together?
- What makes this outfit formula work (or not)?

Return ONLY valid JSON:
{
  "items": [
    {
      "category": "tops|bottoms|dresses|outerwear|shoes|bags|accessories|jewellery|hats|scarves|belts|sunglasses",
      "subcategory": "precise name e.g. wide leg low rise jeans, structured top handle bag, oversized cable knit sweater",
      "colour": "precise colour e.g. midnight black, chalk white, camel, chocolate brown, indigo, burgundy, sage green",
      "material": "e.g. smooth leather, washed denim, ribbed cashmere, brushed wool, silk charmeuse, patent leather",
      "fit": "precise fit description",
      "rise": "low rise|mid rise|high rise (bottoms only)",
      "length": "exact length description including where it hits on the body",
      "break": "no break|slight break|full break|heavy break (trousers/skirts only)",
      "heel": "flat|low block|mid block|high stiletto|wedge|platform (shoes only)",
      "toe": "round|almond|pointed|square (shoes only)",
      "strap_type": "top handle|shoulder|crossbody|clutch|chain|backpack (bags only)",
      "hardware": "gold|silver|antique|none (bags/accessories only)",
      "closure": "e.g. belted, double breasted, flap clasp, zip (outerwear/bags only)",
      "details": "specific distinctive details e.g. raw hem, quilted leather, chain strap, fur collar, pearl buttons",
      "style_vibe": "e.g. 90s minimal, quiet luxury, Scandinavian, vintage, dark academia",
      "search_query": "ultra specific search query to find this exact item e.g. low rise wide leg indigo denim full break raw hem, structured black leather top handle bag gold clasp medium"
    }
  ],
  "outfit_formula": "describe the outfit formula e.g. oversized knit + high rise wide leg trouser + pointed toe loafer",
  "proportions": "describe how proportions work e.g. volume on top balanced by wide leg trouser, creating an even silhouette",
  "overall_vibe": "2-4 word aesthetic",
  "balance_notes": "specific notes on what makes the proportions work, e.g. the floor length break on the trouser is essential with loafers to avoid looking stumpy"
}`;

  return await callOpenAI(prompt, imageUrl);
}

// Board analysis — find recurring outfit formulas across all pins
export async function analyseBoard(pins) {
  const pinsWithImages = pins.filter(p => p.image);
  console.log(`Starting board analysis: ${pinsWithImages.length} pins with images`);
  return { pinsWithImages, total: pinsWithImages.length };
}

// Generate outfit formula illustration using DALL-E
export async function generateFormulaImage(formula, colours, vibe) {
  if (!OPENAI_API_KEY) return null;

  const prompt = `Fashion flat lay illustration. Clean white background. Show these clothing items laid out flat in a styled arrangement: ${formula}. Colour palette: ${colours.join(', ')}. Style: ${vibe}. Minimalist, editorial fashion photography style. No text, no people, no mannequins. Just the clothing items flat laid.`;

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
