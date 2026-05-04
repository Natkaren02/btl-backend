import { supabase } from './supabase.js';

/**
 * Try to find fibre composition data for a second-hand listing
 * by matching brand name + product title against our lookup table.
 *
 * Second-hand listings rarely include fibre data — this function
 * tries to fill the gap by looking up the original product specs.
 * Always marks data as 'brand_lookup' not 'brand_provided'.
 *
 * @param {string} brandName - brand from the listing (may be messy)
 * @param {string} productTitle - product title from listing
 * @returns {{ fibre_data: Object|null, source: string }}
 */
export async function lookupFibreData(brandName, productTitle) {
  if (!brandName) {
    return { fibre_data: null, source: 'unknown' };
  }

  // Clean the brand name for matching
  const cleanBrand = brandName.toLowerCase().trim();

  const { data, error } = await supabase
    .from('fibre_lookup')
    .select('*')
    .ilike('brand_name', `%${cleanBrand}%`)
    .limit(20);

  if (error || !data?.length) {
    return { fibre_data: null, source: 'unknown' };
  }

  // Try to find the best match by product name pattern
  const productLower = productTitle?.toLowerCase() ?? '';

  for (const entry of data) {
    if (!entry.product_name_pattern) {
      // No pattern = applies to all products from this brand
      return { fibre_data: entry.fibre_composition, source: 'brand_lookup' };
    }

    try {
      const regex = new RegExp(entry.product_name_pattern, 'i');
      if (regex.test(productLower)) {
        return { fibre_data: entry.fibre_composition, source: 'brand_lookup' };
      }
    } catch {
      // Invalid regex in DB — skip this entry
    }
  }

  return { fibre_data: null, source: 'unknown' };
}

/**
 * Summarise fibre data into a human-readable format
 * e.g. { cotton: 76, elastane: 24 } → "76% cotton, 24% elastane"
 */
export function formatFibreData(fibreData) {
  if (!fibreData) return null;
  return Object.entries(fibreData)
    .filter(([key]) => !['origin', 'certified', 'source'].includes(key))
    .sort(([, a], [, b]) => b - a)
    .map(([fibre, pct]) => `${pct}% ${fibre}`)
    .join(', ');
}

/**
 * Check if a product is primarily synthetic (bad)
 */
export function isPrimarilySynthetic(fibreData) {
  if (!fibreData) return null; // unknown
  const synthetics = ['polyester', 'nylon', 'acrylic', 'spandex'];
  const syntheticTotal = Object.entries(fibreData)
    .filter(([key]) => synthetics.includes(key.toLowerCase()))
    .reduce((sum, [, pct]) => sum + (pct || 0), 0);
  return syntheticTotal > 50;
}
