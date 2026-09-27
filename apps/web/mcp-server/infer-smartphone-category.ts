const handsetBrandWords = new Set([
  'apple', 'google', 'pixel', 'samsung', 'galaxy', 'redmi', 'xiaomi',
  'tecno', 'infinix', 'itel', 'nokia', 'motorola', 'oppo', 'vivo',
  'realme', 'oneplus', 'nothing', 'honor',
]);
const allowedPrefixWords = new Set([
  ...handsetBrandWords, 'new', 'used', 'refurbished',
  'android', '4g', '5g', 'cheap', 'affordable', 'best', 'latest',
]);
const modelModifiers = new Set(['pro', 'max', 'plus', 'mini', 'ultra']);
const brandedModelFamilyWords = new Set(['z', 'fold', 'flip']);

/** Infer a handset category only when the query clearly names a phone itself. */
export function inferSmartphoneCategory(
  query: string | undefined,
  explicitCategory: string | undefined
): 'Smartphones' | undefined {
  if (!query || explicitCategory) return undefined;
  const handset = /\b(?:iphones?|smartphones?|mobile phones?|phones?)\b/i.exec(query);
  if (!handset) return undefined;
  const prefix = query.slice(0, handset.index)
    .replace(/^\s*(?:(?:looking|searching|shopping)\s+for|(?:show|find|search)(?:\s+me)?(?:\s+for)?|i\s+(?:want|need))\s+(?:(?:an?|some)\s+)?/i, '');
  const prefixWords = prefix.trim().toLowerCase().split(/\s+/);
  let hasBrand = false;
  let hasModel = false;
  if (prefix.trim() && !prefixWords.every((word) => {
    if (handsetBrandWords.has(word)) hasBrand = true;
    if (hasBrand && /^(?:[a-z]{1,3})?\d{1,3}[a-z]?$/.test(word)) {
      hasModel = true;
      return true;
    }
    return allowedPrefixWords.has(word) ||
      (hasModel && modelModifiers.has(word)) ||
      (hasBrand && brandedModelFamilyWords.has(word));
  })) {
    return undefined;
  }

  let remainder = query.slice(handset.index + handset[0].length).trim().replace(/[?.!,]+$/, '').trim();
  remainder = remainder.replace(/^(?:\d{1,3}[a-z]?|SE|XR|XS)(?:\s+(?:pro|max|plus|mini|ultra)){0,2}(?=\s|$)/i, '').trim();
  while (/^(?:[45]G|\d+(?:GB|TB))(?=\s|$)/i.test(remainder)) {
    remainder = remainder.replace(/^(?:[45]G|\d+(?:GB|TB))(?=\s|$)/i, '').trim();
  }
  remainder = remainder.replace(/^(?:smartphones?|mobile phones?|phones?)$/i, '').trim();
  const priceOnly = /^(?:under|below|from|at)\s+[₦$]?\d[\d,.]*[km]?(?:\s*(?:ngn|naira))?$/i.test(remainder) ||
    /^between\s+[₦$]?\d[\d,.]*[km]?\s+and\s+[₦$]?\d[\d,.]*[km]?$/i.test(remainder);
  return !remainder || priceOnly ? 'Smartphones' : undefined;
}
