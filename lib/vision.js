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
        model: 'gpt-4o-mini',
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

  // Step 1: Ask specific visual questions about what is visible
  const step1 = await callOpenAI([{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
      { type: 'text', text: `Look at this image carefully and answer these specific questions about what you can SEE. Answer only from visual evidence.

1. SHOULDERS: Can you see the person's shoulders? Are they bare (no fabric) or covered? If bare, is there any strap at all visible on the shoulder?
2. NECK AREA: Can you see straps going around the neck? Or just bare neck?
3. TOP TYPE: Based on what you can see of the shoulders and straps, what type of top is it? Options: halter (neck straps), tank (shoulder straps), camisole (thin spaghetti straps), strapless (no straps), sleeved top. If you genuinely cannot tell from the visible evidence, say "unclear".
4. JEANS/TROUSERS: What is the width of the leg at the thigh compared to at the ankle? Is the ankle area: much wider than thigh (flare), same width as thigh (wide leg), slightly narrower than thigh (barrel/baggy), much narrower (slim/skinny), same narrow width throughout (straight)?
5. TROUSER HEM: Can you see the hem of the trousers/jeans? If yes, where does it sit - on the floor, at the ankle, above the ankle? If the hem is not visible but you can see the flow of the fabric, describe what you observe about how the fabric falls.
6. WAISTBAND: Can you see where the waistband sits on the body? Does it sit below the hip bones (low rise), at the hip bones (mid rise), or above the navel (high rise)?
7. BAG: Describe exactly what you can see about any bag - material (leather, suede, canvas), shape, handle type, any decorative details like fringe, hardware colour.
8. OTHER ITEMS: List any other visible items - shoes, jewellery, belts, etc.

Answer each question directly based only on what you can see.` }
    ]
  }]);

  if (!step1) return null;

  // Step 2: Convert the answers into structured JSON
  const step2 = await callOpenAI([
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
        { type: 'text', text: `Look at this image carefully and answer these specific questions about what you can SEE. Answer only from visual evidence.

1. SHOULDERS: Can you see the person's shoulders? Are they bare (no fabric) or covered? If bare, is there any strap at all visible on the shoulder?
2. NECK AREA: Can you see straps going around the neck? Or just bare neck?
3. TOP TYPE: Based on what you can see of the shoulders and straps, what type of top is it? Options: halter (neck straps), tank (shoulder straps), camisole (thin spaghetti straps), strapless (no straps), sleeved top. If you genuinely cannot tell from the visible evidence, say "unclear".
4. JEANS/TROUSERS: What is the width of the leg at the thigh compared to at the ankle? Is the ankle area: much wider than thigh (flare), same width as thigh (wide leg), slightly narrower than thigh (barrel/baggy), much narrower (slim/skinny), same narrow width throughout (straight)?
5. TROUSER HEM: Can you see the hem of the trousers/jeans? If yes, where does it sit - on the floor, at the ankle, above the ankle? If the hem is not visible but you can see the flow of the fabric, describe what you observe about how the fabric falls.
6. WAISTBAND: Can you see where the waistband sits on the body? Does it sit below the hip bones (low rise), at the hip bones (mid rise), or above the navel (high rise)?
7. BAG: Describe exactly what you can see about any bag - material (leather, suede, canvas), shape, handle type, any decorative details like fringe, hardware colour.
8. OTHER ITEMS: List any other visible items - shoes, jewellery, belts, etc.

Answer each question directly based only on what you can see.` }
      ]
    },
    { role: 'assistant', content: step1 },
    {
      role: 'user',
      content: `Based on your answers above, now create a JSON object describing each item. Use ONLY information from your answers — do not add anything you did not observe.

For the top: use the strap/shoulder evidence to determine the type. If you said halter straps visible = halter top. If bare shoulder no straps = strapless or halter, note uncertainty.
For trousers: use the leg width comparison to determine the cut (wide leg, barrel, straight etc).
For length: if hem not visible but fabric clearly flows to floor = "floor length". Only say "cropped" if you can actually see the hem above ankle height.

Return ONLY this JSON, nothing else:
{
  "items": [
    {
      "category": "tops|bottoms|dresses|outerwear|shoes|bags|accessories|jewellery",
      "subcategory": "specific type from your observations e.g. halter top, wide leg jeans, suede fringe shoulder bag",
      "colour": "colour you observed",
      "material": "only if you identified it: denim|leather|suede|knit|silk|canvas|faux fur",
      "fit": "specific cut from your observations",
      "rise": "low rise|mid rise|high rise — only if you observed the waistband position",
      "length": "floor length|ankle length|midi|knee length|mini|cropped — based on your hem observations",
      "details": "specific details you observed",
      "obscured_by": "what you could not see clearly"
    }
  ],
  "outfit_formula": "precise description of the combination",
  "overall_vibe": "2-3 word aesthetic",
  "proportions": "how the silhouette works"
}`
    }
  ]);

  if (!step2) return null;

  try {
    const jsonMatch = step2.match(/\{[\s\S]*\}/);
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
