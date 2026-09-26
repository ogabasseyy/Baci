const allowedPrefixWords = new Set([
  'apple', 'google', 'pixel', 'samsung', 'galaxy', 'redmi', 'xiaomi',
  'tecno', 'infinix', 'itel', 'nokia', 'motorola', 'oppo', 'vivo',
  'realme', 'oneplus', 'nothing', 'honor', 'new', 'used', 'refurbished',
  'cheap', 'affordable', 'best', 'latest',
]);

/** Infer a handset category only when the query clearly names a phone itself. */
export function inferSmartphoneCategory(
  query: string | undefined,
  explicitCategory: string | undefined
): 'Smartphones' | undefined {
  if (!query || explicitCategory) return undefined;
  const handset = /\b(?:iphones?|smartphones?|mobile phones?|phones?)\b/i.exec(query);
  if (!handset) return undefined;
  const prefix = query.slice(0, handset.index)
    .replace(/^\s*(?:looking|searching|shopping)\s+for\s+/i, '');
  if (prefix.trim() && !prefix.trim().toLowerCase().split(/\s+/).every((word) => allowedPrefixWords.has(word))) {
    return undefined;
  }

  let remainder = query.slice(handset.index + handset[0].length).trim().replace(/[?.!,]+$/, '').trim();
  remainder = remainder.replace(/^(?:\d{1,3}[a-z]?|SE|XR|XS)(?:\s+(?:pro|max|plus|mini|ultra)){0,2}(?=\s|$)/i, '').trim();
  while (/^(?:[45]G|\d+(?:GB|TB))(?=\s|$)/i.test(remainder)) {
    remainder = remainder.replace(/^(?:[45]G|\d+(?:GB|TB))(?=\s|$)/i, '').trim();
  }
  const priceOnly = /^(?:under|below|from|at)\s+[₦$]?\d[\d,.]*(?:\s*(?:ngn|naira))?$/i.test(remainder) ||
    /^between\s+[₦$]?\d[\d,.]*\s+and\s+[₦$]?\d[\d,.]*$/i.test(remainder);
  return !remainder || priceOnly ? 'Smartphones' : undefined;
}
