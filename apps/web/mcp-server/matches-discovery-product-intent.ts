type ProductText = {
  brand?: string | null;
  category?: string | null;
  description?: string | null;
  name?: string | null;
};

const genericTypes = new Set([
  'device', 'devices', 'gadget', 'gadgets', 'item', 'items',
  'product', 'products', 'thing', 'things',
]);
const detailBoundary = new Set(['under', 'below', 'between', 'with', 'for', 'at', 'in', 'priced', 'costing']);
const modelAnchorStopwords = new Set(['a', 'an', 'the', 'model', 'version', 'size', 'of', 'for', 'with']);
const genericPhoneModifiers = new Set([
  'android', 'budget', 'cheap', 'fast', 'good', 'latest', 'mobile', 'new',
  'refurbished', 'smart', 'unlocked', 'used',
]);
const phoneAccessoryTypes = new Set([
  'cable', 'cables', 'case', 'cases', 'charger', 'chargers', 'cover', 'covers',
  'earbud', 'earbuds', 'holder', 'holders', 'lens', 'lenses', 'pouch', 'pouches',
  'protector', 'protectors', 'stand', 'stands', 'wallet', 'wallets',
]);
const productTypes = new Set([
  ...phoneAccessoryTypes, 'bank', 'banks', 'camera', 'cameras', 'diffuser', 'diffusers',
  'earphone', 'earphones', 'headphone', 'headphones', 'laptop', 'laptops',
  'mouse', 'mice', 'phone', 'phones', 'printer', 'printers', 'speaker', 'speakers',
  'smartphone', 'smartphones', 'tablet', 'tablets', 'watch', 'watches',
]);
const accessoryHeadTypes = new Set([
  'case', 'cases', 'cover', 'covers', 'holder', 'holders', 'pouch', 'pouches',
  'protector', 'protectors', 'stand', 'stands', 'wallet', 'wallets',
]);
const knownBrandWords = new Set([
  'apple', 'dell', 'google', 'hp', 'huawei', 'infinix', 'itel', 'jbl',
  'lenovo', 'lg', 'nokia', 'oppo', 'pixel', 'realme', 'redmi', 'riversong',
  'samsung', 'sony', 'tecno', 'vivo', 'xiaomi',
]);
const modelQualifiers = new Set(['max', 'mini', 'plus', 'pro', 'ultra']);

function words(value: string): string[] {
  return value.normalize('NFKC').toLocaleLowerCase('en').match(/[a-z0-9]+/g) ?? [];
}

function matchesWord(textWords: string[], term: string): boolean {
  const irregular = new Map([
    ['lenses', 'lens'], ['mice', 'mouse'], ['pouches', 'pouch'], ['watches', 'watch'],
  ]);
  const singular = irregular.get(term) ?? (term.endsWith('ies')
    ? `${term.slice(0, -3)}y`
    : term.replace(/s$/, ''));
  return textWords.some((word) =>
    word === term || word === singular || word === `${singular}s` ||
    (singular === 'phone' && (word === 'smartphone' || word === 'smartphones')) ||
    (singular === 'earbud' && (word === 'bud' || word === 'buds'))
  );
}

function matchesProductToken(textWords: string[], token: string): boolean {
  if (matchesWord(textWords, token)) return true;
  const compactUnit = /^(\d+)([a-z]+)$/.exec(token);
  return Boolean(compactUnit && textWords.some((word, index) =>
    word === compactUnit[1] && textWords[index + 1] === compactUnit[2]));
}

/** Keep the requested item type and explicit model attached to search results.
 * Embeddings alone can otherwise return a phone for a request for its case. */
export function matchesDiscoveryProductIntent(product: ProductText, query: string | undefined): boolean {
  if (!query) return true;
  const normalized = query.normalize('NFKC').toLocaleLowerCase('en')
    .replace(/^\s*(?:(?:looking|searching|shopping)\s+for|(?:show|find|search|buy)(?:\s+me)?(?:\s+for)?|i\s+(?:want|need))\s+(?:(?:a|an|some)\s+)?/i, '');
  const queryWords = words(normalized);
  if (queryWords.filter((word) => /^[a-z]+$/.test(word)).length < 2) return true;

  const priceBoundary = queryWords.findIndex((word) => word === 'under' || word === 'below' || word === 'between');
  const coreWords = priceBoundary < 0 ? queryWords : queryWords.slice(0, priceBoundary);
  const detailIndex = coreWords.findIndex((word) => detailBoundary.has(word));
  const itemWords = detailIndex < 0 ? coreWords : coreWords.slice(0, detailIndex);
  const lastWord = itemWords.at(-1);
  if (!lastWord || genericTypes.has(lastWord)) return true;
  const itemType = itemWords.findLast((word) => productTypes.has(word));

  // The lead describes the item itself; later boilerplate often mentions
  // compatible cases, chargers, phones, and other unrelated products.
  const itemText = words([product.name, product.brand, product.category].filter(Boolean).join(' '));
  const identityWords = words([product.name, product.brand].filter(Boolean).join(' '));
  const descriptionIdentifiesType = itemType && new RegExp(
    `\\bis\\s+(?:a|an)\\s+(?:[a-z0-9-]+\\s+){0,3}${itemType}\\b`, 'i'
  ).test(product.description?.slice(0, 300) ?? '');
  if (itemType && !matchesWord(itemText, itemType) && !descriptionIdentifiesType) return false;
  const categoryWords = words(product.category ?? '');
  const nameWords = words(product.name ?? '');
  const isHandsetCategory = categoryWords.includes('smartphones') ||
    (categoryWords.some((word) => matchesWord([word], 'phone')) &&
      !categoryWords.some((word) => ['accessory', 'accessories', 'case', 'cases'].includes(word)));
  if (itemType && phoneAccessoryTypes.has(itemType) && isHandsetCategory) return false;

  // A description can identify an otherwise untitled item, but it must not
  // override a different product type stated in the title.
  if (itemType && !matchesWord([...nameWords, ...categoryWords], itemType) &&
    nameWords.some((word) => productTypes.has(word))) return false;

  // A compatible-item mention cannot turn an accessory into the item itself.
  if (itemType && !categoryWords.some((word) => matchesWord([word], itemType)) &&
    nameWords.some((word) => accessoryHeadTypes.has(word) && !matchesWord([word], itemType))) return false;

  const requestedBrands = itemWords.filter((word) => knownBrandWords.has(word));
  if (requestedBrands.some((brand) => !matchesWord(identityWords, brand))) return false;

  // "Phone pouch" describes an accessory, even if its description mentions
  // phones. A handset must be catalogued or named as the actual item.
  if (itemType === 'phone' || itemType === 'phones' || itemType === 'smartphone' || itemType === 'smartphones') {
    if (!isHandsetCategory &&
      !matchesWord(nameWords.slice(-1), 'phone')) return false;

    const modifier = itemWords[itemWords.indexOf(itemType) - 1];
    if (modifier && /^[a-z]+$/.test(modifier) && !genericPhoneModifiers.has(modifier) &&
      !matchesWord(itemText, modifier)) return false;
  }

  for (const [index, token] of coreWords.entries()) {
    if (!/\d/.test(token) || token.length < 2 || token.length > 10 || /^[0-9][gk]$/.test(token)) continue;
    if (!matchesProductToken(itemText, token)) return false;
    const preceding = coreWords[index - 1];
    if (preceding && /^[a-z]+$/.test(preceding) && !modelAnchorStopwords.has(preceding) &&
      !matchesWord(itemText, preceding)) return false;
    for (let next = index + 1; modelQualifiers.has(coreWords[next]); next += 1) {
      if (!matchesWord(identityWords, coreWords[next])) return false;
    }
  }
  return true;
}
