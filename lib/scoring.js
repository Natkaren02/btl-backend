// Sustainability scoring — 0 to 100
// Each product gets a score based on source, fibre data, and brand verification

const SCORES = {
  source: {
    second_hand:    35,  // second-hand is the baseline good
    verified_brand: 25,  // new but from verified sustainable brand
    unverified:      0,  // unverified brand — no points
  },
  fibre: {
    // natural non-synthetic (best)
    organic_cotton: 20,
    linen:          20,
    hemp:           20,
    wool:           18,
    cashmere:       16,
    silk:           14,
    tencel:         16,
    lyocell:        16,
    cotton:         12,

    // recycled synthetics (ok, but not ideal)
    recycled_polyester: 8,
    recycled_nylon:     8,

    // virgin synthetics (bad)
    polyester:    -10,
    nylon:         -8,
    acrylic:      -12,
    elastane:      -3,  // small amounts tolerated
    spandex:       -3,
  },
  certifications: {
    'GOTS':      12,
    'Fair Trade': 10,
    'B Corp':    10,
    'OEKO-TEX':   8,
    'RWS':        6,   // Responsible Wool Standard
    'FSC':        4,
    'Bluesign':   6,
  },
  dataQuality: {
    brand_provided:  10,  // brand gave us the data directly
    brand_lookup:     5,  // we found it from original product specs
    unknown:          0,  // we don't know — no bonus, no penalty
  }
};

/**
 * Calculate sustainability score for a product
 * @param {Object} product
 * @param {string} product.source - 'vinted' | 'dba' | 'sellply' | 'brand_direct'
 * @param {Object|null} product.fibre_data - { cotton: 60, linen: 40, certified: true }
 * @param {string} product.fibre_data_source - 'brand_provided' | 'brand_lookup' | 'unknown'
 * @param {Object|null} product.brand - brand record with certifications array
 * @returns {{ score: number, breakdown: Object }}
 */
export function calculateScore(product) {
  let score = 0;
  const breakdown = {};

  // 1. Source score
  const isSecondHand = ['vinted', 'dba'].includes(product.source);
  const sourceScore = isSecondHand
    ? SCORES.source.second_hand
    : (product.brand?.verified ? SCORES.source.verified_brand : SCORES.source.unverified);

  score += sourceScore;
  breakdown.source = { points: sourceScore, reason: isSecondHand ? 'Second-hand' : (product.brand?.verified ? 'Verified brand' : 'Unverified brand') };

  // 2. Fibre score
  if (product.fibre_data && product.fibre_data_source !== 'unknown') {
    let fibreScore = 0;
    const fibres = { ...product.fibre_data };
    delete fibres.origin;
    delete fibres.certified;

    for (const [fibre, percentage] of Object.entries(fibres)) {
      const fibreKey = fibre.toLowerCase().replace(/[^a-z_]/g, '_');
      const pointsPerPercent = (SCORES.fibre[fibreKey] ?? 0) / 100;
      fibreScore += pointsPerPercent * (percentage || 0);
    }

    fibreScore = Math.round(Math.max(-20, Math.min(25, fibreScore)));
    score += fibreScore;
    breakdown.fibre = { points: fibreScore, data: product.fibre_data };
  } else {
    breakdown.fibre = { points: 0, reason: 'Fibre data unknown' };
  }

  // 3. Data quality bonus
  const dataQualityScore = SCORES.dataQuality[product.fibre_data_source] ?? 0;
  score += dataQualityScore;
  breakdown.dataQuality = { points: dataQualityScore, source: product.fibre_data_source };

  // 4. Certification bonus (from brand)
  let certScore = 0;
  if (product.brand?.certifications?.length) {
    for (const cert of product.brand.certifications) {
      certScore += SCORES.certifications[cert] ?? 0;
    }
    certScore = Math.min(15, certScore); // cap at 15
  }
  score += certScore;
  breakdown.certifications = { points: certScore, certs: product.brand?.certifications ?? [] };

  // Final clamp to 0–100
  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, breakdown };
}

/**
 * Get a human-readable label for a score
 */
export function scoreLabel(score) {
  if (score >= 85) return { label: 'Excellent', color: 'green' };
  if (score >= 70) return { label: 'Good', color: 'green' };
  if (score >= 50) return { label: 'Moderate', color: 'amber' };
  if (score >= 30) return { label: 'Limited data', color: 'amber' };
  return { label: 'Low', color: 'red' };
}
