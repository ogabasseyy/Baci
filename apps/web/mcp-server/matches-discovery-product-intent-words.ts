export type ProductText = {
  brand?: string | null;
  category?: string | null;
  description?: string | null;
  name?: string | null;
};

export const genericTypes = new Set([
  'device', 'devices', 'gadget', 'gadgets', 'item', 'items',
  'product', 'products', 'thing', 'things',
]);
export const detailBoundary = new Set(['under', 'below', 'between', 'with', 'for', 'at', 'in', 'priced', 'costing']);
export const modelAnchorStopwords = new Set(['a', 'an', 'the', 'model', 'version', 'size', 'of', 'for', 'with']);
export const genericPhoneModifiers = new Set([
  'android', 'budget', 'cheap', 'fast', 'good', 'latest', 'mobile', 'new',
  'refurbished', 'smart', 'unlocked', 'used',
]);
export const genericItemModifiers = new Set([
  ...genericPhoneModifiers, 'and', 'or', 'affordable', 'anything', 'c', 'compact', 'gaming', 'home', 'office', 'portable',
  'power', 'security', 'something', 'usb', 'wireless',
]);
export const phoneAccessoryTypes = new Set([
  'cable', 'cables', 'case', 'cases', 'charger', 'chargers', 'cover', 'covers',
  'earbud', 'earbuds', 'holder', 'holders', 'lens', 'lenses', 'pouch', 'pouches',
  'protector', 'protectors', 'stand', 'stands', 'wallet', 'wallets',
]);
export const productTypes = new Set([
  ...phoneAccessoryTypes, 'accessory', 'accessories', 'adapter', 'adapters', 'bank', 'banks',
  'camera', 'cameras', 'diffuser', 'diffusers', 'earbud', 'earbuds', 'earphone', 'earphones',
  'headphone', 'headphones', 'keyboard', 'keyboards', 'laptop', 'laptops', 'macbook', 'macbooks',
  'monitor', 'monitors', 'mouse', 'mice', 'phone', 'phones', 'printer', 'printers', 'speaker', 'speakers',
  'smartphone', 'smartphones', 'stylus', 'styluses', 'tablet', 'tablets', 'television', 'televisions',
  'tv', 'tvs', 'watch', 'watches',
]);
export const accessoryHeadTypes = new Set([
  'case', 'cases', 'cover', 'covers', 'holder', 'holders', 'pouch', 'pouches',
  'protector', 'protectors', 'stand', 'stands', 'wallet', 'wallets',
]);
export const knownBrandWords = new Set([
  'apple', 'dell', 'google', 'hp', 'huawei', 'infinix', 'itel', 'jbl',
  'lenovo', 'lg', 'nokia', 'oppo', 'pixel', 'realme', 'redmi', 'riversong',
  'samsung', 'sony', 'tecno', 'vivo', 'xiaomi',
]);
export const knownDeviceFamilyWords = new Set([
  'airpod', 'airpods', 'galaxy', 'ipad', 'iphone', 'iphones', 'macbook', 'pixel', 'pixels',
]);
export const deviceQualifierAliases = new Map<string, string[]>([
  ['phone', ['phone', 'smartphone', 'iphone']],
  ['phones', ['phone', 'smartphone', 'iphone']],
  ['smartphone', ['phone', 'smartphone', 'iphone']],
  ['smartphones', ['phone', 'smartphone', 'iphone']],
  ['laptop', ['laptop', 'macbook', 'notebook']],
  ['laptops', ['laptop', 'macbook', 'notebook']],
  ['camera', ['camera']],
  ['cameras', ['camera']],
  ['tablet', ['tablet', 'ipad']],
  ['tablets', ['tablet', 'ipad']],
]);
export const modelQualifiers = new Set(['max', 'mini', 'plus', 'pro', 'ultra']);

const irregularPlurals = new Map([
  ['lenses', 'lens'], ['mice', 'mouse'], ['pouches', 'pouch'], ['styluses', 'stylus'], ['watches', 'watch'],
]);
const irregularSingulars = new Map([
  ['lens', 'lenses'], ['mouse', 'mice'], ['pouch', 'pouches'], ['stylus', 'styluses'], ['watch', 'watches'],
]);
const equivalentTerms = new Map([
  ['mouse', ['mice']], ['mice', ['mouse']],
  ['tv', ['television', 'televisions']], ['tvs', ['television', 'televisions']],
  ['television', ['tv', 'tvs']], ['televisions', ['tv', 'tvs']],
]);
const separatedSpecUnits = new Set(['gb', 'tb', 'mb', 'mah', 'w', 'hz', 'mp']);

export function words(value: string): string[] {
  return value.normalize('NFKC').replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1')
    .toLocaleLowerCase('en').match(/[a-z0-9]+/g) ?? [];
}

export function matchesWord(textWords: string[], term: string): boolean {
  // Known singulars keep their trailing "s" ("lens" is not "len" + "s").
  const singular = irregularSingulars.has(term)
    ? term
    : irregularPlurals.get(term) ?? (term.endsWith('ies')
      ? `${term.slice(0, -3)}y`
      : term.replace(/s$/, ''));
  const plural = irregularSingulars.get(singular) ?? `${singular}s`;
  const equivalents = equivalentTerms.get(term) ?? [];
  return textWords.some((word) =>
    word === term || word === singular || word === plural ||
    equivalents.includes(word) ||
    (singular === 'phone' && (word === 'smartphone' || word === 'smartphones')) ||
    (singular === 'earbud' && (word === 'bud' || word === 'buds'))
  );
}

export function matchesProductToken(textWords: string[], token: string): boolean {
  if (matchesWord(textWords, token)) return true;
  const compactUnit = /^(\d+)([a-z]+)$/.exec(token);
  return Boolean(compactUnit && textWords.some((word, index) =>
    word === compactUnit[1] && textWords[index + 1] === compactUnit[2]));
}

export function hasConsecutiveWords(textWords: string[], expectedWords: string[]): boolean {
  return textWords.some((_, start) => expectedWords.every((word, offset) =>
    matchesWord([textWords[start + offset] ?? ''], word)
  ));
}

/** Join a separated number/unit pair ("16", "gb") into its compact spec form ("16gb").
 * Returns the token itself when it is already compact, or undefined when the
 * token carries no specification. "ram" stays a context word, not a unit. */
export function joinSpecToken(token: string, nextWord: string | undefined): string | undefined {
  if (/^\d+(?:gb|tb|mb|mah|w|hz|mp|ram)$/.test(token)) return token;
  if (/^\d+$/.test(token) && nextWord && separatedSpecUnits.has(nextWord)) return `${token}${nextWord}`;
  return undefined;
}

export type IntentBranch = {
  phraseWords: string[];
  prefixWords: string[];
  type: string;
};

export type IntentWordScope = {
  categoryWords: string[];
  descriptionLead: string[];
  deviceIdentityText: string[];
  identityScope: string[];
  identityWords: string[];
  isHandsetCategory: boolean;
  itemText: string[];
  nameWords: string[];
};

/** A device noun that qualifies the item ("phone" in "phone case") must agree
 * with the product's identity; a conflicting device head rejects the candidate. */
export function matchesRequestedDevice(
  requestedDevice: string | undefined, scope: IntentWordScope
): boolean {
  if (!requestedDevice) return true;
  const aliases = deviceQualifierAliases.get(requestedDevice) ?? [];
  const identifiesRequested = aliases.some((alias) => matchesWord(scope.deviceIdentityText, alias));
  const identifiesConflicting = [...deviceQualifierAliases.values()].some((otherAliases) =>
    !aliases.some((alias) => otherAliases.includes(alias)) &&
    otherAliases.some((alias) => matchesWord(scope.deviceIdentityText, alias))
  );
  const accessoryTypeIndex = scope.nameWords.findLastIndex((word) => phoneAccessoryTypes.has(word));
  const titleQualifier = scope.nameWords.slice(0, accessoryTypeIndex < 0 ? scope.nameWords.length : accessoryTypeIndex)
    .findLast((word) => deviceQualifierAliases.has(word));
  if (titleQualifier) {
    const titleQualifierAliases = deviceQualifierAliases.get(titleQualifier) ?? [];
    if (!aliases.some((alias) => titleQualifierAliases.includes(alias))) return false;
  }
  return !identifiesConflicting || identifiesRequested;
}

/** Check one "A or B" alternative against the candidate. Descriptive branch
 * terms may live in the category or description lead; only the device head
 * and item type must identify the product itself. */
export function matchesAlternativeBranch(
  { prefixWords, type }: IntentBranch, scope: IntentWordScope
): boolean {
  if (!matchesWord(scope.itemText, type) && !matchesWord(scope.descriptionLead, type)) return false;
  const requestedDeviceForBranch = prefixWords.findLast((word) => deviceQualifierAliases.has(word));
  if (!matchesRequestedDevice(requestedDeviceForBranch, scope)) return false;
  const requestedTerms = prefixWords.filter((word) =>
    !productTypes.has(word) && !genericItemModifiers.has(word) &&
    !knownDeviceFamilyWords.has(word) && !modelQualifiers.has(word) && !/\d/.test(word) &&
    /^[a-z]{2,}$/.test(word)
  );
  if (requestedTerms.some((term) => !matchesWord(scope.identityScope, term))) return false;
  // A branch matches only when its own model/spec numbers fit the candidate,
  // so "iPhone 15 case or iPhone 14 case" narrows to one branch per product.
  for (const [position, token] of prefixWords.entries()) {
    if (!/\d/.test(token) || token.length < 2 || token.length > 10 || /^[0-9][gk]$/.test(token)) continue;
    const spec = joinSpecToken(token, prefixWords[position + 1]);
    if (spec) {
      if (!matchesProductToken(scope.identityScope, spec)) return false;
    } else if (!matchesProductToken(scope.itemText, token)) return false;
  }
  const handsetType = type === 'phone' || type === 'phones' || type === 'smartphone' || type === 'smartphones';
  if (handsetType && !scope.isHandsetCategory && !matchesWord(scope.nameWords.slice(-1), 'phone')) return false;
  if (phoneAccessoryTypes.has(type) && scope.isHandsetCategory) return false;
  if ((type === 'accessory' || type === 'accessories') && !scope.categoryWords.some((word) => word.includes('accessor')) &&
    !scope.nameWords.some((word) => word.includes('accessor') || phoneAccessoryTypes.has(word) || accessoryHeadTypes.has(word))) return false;
  if (!scope.categoryWords.some((word) => matchesWord([word], type)) &&
    scope.nameWords.some((word) => accessoryHeadTypes.has(word) && !matchesWord([word], type))) return false;
  if (!phoneAccessoryTypes.has(type) && scope.nameWords.some((word) => accessoryHeadTypes.has(word))) return false;
  return true;
}
