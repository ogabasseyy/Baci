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
const genericItemModifiers = new Set([
  ...genericPhoneModifiers, 'and', 'or', 'affordable', 'c', 'compact', 'gaming', 'home', 'office', 'portable', 'power',
  'security', 'usb', 'wireless',
]);
const phoneAccessoryTypes = new Set([
  'cable', 'cables', 'case', 'cases', 'charger', 'chargers', 'cover', 'covers',
  'earbud', 'earbuds', 'holder', 'holders', 'lens', 'lenses', 'pouch', 'pouches',
  'protector', 'protectors', 'stand', 'stands', 'wallet', 'wallets',
]);
const productTypes = new Set([
  ...phoneAccessoryTypes, 'accessory', 'accessories', 'adapter', 'adapters', 'bank', 'banks',
  'camera', 'cameras', 'diffuser', 'diffusers', 'earbud', 'earbuds', 'earphone', 'earphones',
  'headphone', 'headphones', 'keyboard', 'keyboards', 'laptop', 'laptops', 'macbook', 'macbooks',
  'monitor', 'monitors', 'mouse', 'mice', 'phone', 'phones', 'printer', 'printers', 'speaker', 'speakers',
  'smartphone', 'smartphones', 'stylus', 'styluses', 'tablet', 'tablets', 'television', 'televisions',
  'tv', 'tvs', 'watch', 'watches',
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
const knownDeviceFamilyWords = new Set([
  'airpod', 'airpods', 'galaxy', 'ipad', 'iphone', 'iphones', 'macbook', 'pixel', 'pixels',
]);
const deviceQualifierAliases = new Map<string, string[]>([
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
const modelQualifiers = new Set(['max', 'mini', 'plus', 'pro', 'ultra']);

function words(value: string): string[] {
  return value.normalize('NFKC').replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1')
    .toLocaleLowerCase('en').match(/[a-z0-9]+/g) ?? [];
}

function matchesWord(textWords: string[], term: string): boolean {
  const irregular = new Map([
    ['lenses', 'lens'], ['mice', 'mouse'], ['pouches', 'pouch'], ['watches', 'watch'],
  ]);
  const equivalentTerms = new Map([
    ['mouse', ['mice']], ['mice', ['mouse']],
    ['tv', ['television', 'televisions']], ['tvs', ['television', 'televisions']],
    ['television', ['tv', 'tvs']], ['televisions', ['tv', 'tvs']],
  ]);
  const singular = irregular.get(term) ?? (term.endsWith('ies')
    ? `${term.slice(0, -3)}y`
    : term.replace(/s$/, ''));
  const equivalents = equivalentTerms.get(term) ?? [];
  return textWords.some((word) =>
    word === term || word === singular || word === `${singular}s` ||
    equivalents.includes(word) ||
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

function hasConsecutiveWords(textWords: string[], expectedWords: string[]): boolean {
  return textWords.some((_, start) => expectedWords.every((word, offset) =>
    matchesWord([textWords[start + offset] ?? ''], word)
  ));
}

/** Keep the requested item type and explicit model attached to search results.
 * Embeddings alone can otherwise return a phone for a request for its case. */
export function matchesDiscoveryProductIntent(product: ProductText, query: string | undefined): boolean {
  if (!query) return true;
  const rawQuery = query.normalize('NFKC').toLocaleLowerCase('en').trim();
  const normalized = rawQuery
    .replace(/^\s*(?:(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:show|find|search|buy|get|recommend|suggest)(?:\s+me)?(?:\s+for)?|(?:looking|searching|shopping)\s+for|i\s+(?:want|need))(?:\s+(?:a|an|some|the))?\s+/i, '');
  const queryWords = words(normalized);
  if (queryWords.filter((word) => /^[a-z]+$/.test(word)).length < 2 &&
    !queryWords.some((word) => /\d/.test(word)) && normalized === rawQuery) return true;

  const priceBoundary = queryWords.findIndex((word) => word === 'under' || word === 'below' || word === 'between');
  const coreWords = priceBoundary < 0 ? queryWords : queryWords.slice(0, priceBoundary);
  const detailIndex = coreWords.findIndex((word, index) =>
    detailBoundary.has(word) && !(word === 'in' && (coreWords[index - 1] === 'all' || /^\d+$/.test(coreWords[index - 1] ?? '')))
  );
  const itemWords = detailIndex < 0 ? [...coreWords] : coreWords.slice(0, detailIndex);
  while (genericTypes.has(itemWords.at(-1) ?? '')) itemWords.pop();
  if (itemWords.length === 0) return true;
  const alternativePhrases: string[][] = [];
  let currentPhrase: string[] = [];
  for (const word of itemWords) {
    if (word === 'and' || word === 'or') {
      if (currentPhrase.length > 0) alternativePhrases.push(currentPhrase);
      currentPhrase = [];
    } else {
      currentPhrase.push(word);
    }
  }
  if (currentPhrase.length > 0) alternativePhrases.push(currentPhrase);
  const alternativeBranches = alternativePhrases.length > 1
    ? alternativePhrases.flatMap((phrase) => {
      const typeIndex = phrase.findLastIndex((word) => productTypes.has(word));
      return typeIndex < 0 ? [] : [{ type: phrase[typeIndex] ?? '', prefixWords: phrase.slice(0, typeIndex) }];
    })
    : [];
  const hasAlternativeItemTypes = alternativeBranches.length > 1;
  const itemTypeIndexes = itemWords.flatMap((word, index) => productTypes.has(word) ? [index] : []);
  const itemTypeIndex = hasAlternativeItemTypes ? -1 : itemTypeIndexes.at(-1) ?? -1;
  const itemType = itemTypeIndex >= 0 ? itemWords[itemTypeIndex] : undefined;

  // The lead describes the item itself; later boilerplate often mentions
  // compatible cases, chargers, phones, and other unrelated products.
  const itemText = words([product.name, product.brand, product.category].filter(Boolean).join(' '));
  const identityWords = words([product.name, product.brand].filter(Boolean).join(' '));
  const nameWords = words(product.name ?? '');
  const deviceIdentityText = words([product.name, product.category].filter(Boolean).join(' '));
  const itemPrefixWords = itemTypeIndex < 0 ? itemWords : itemWords.slice(0, itemTypeIndex);
  const requestedDevice = hasAlternativeItemTypes
    ? undefined
    : itemPrefixWords.findLast((word) => deviceQualifierAliases.has(word));
  if (requestedDevice) {
    const requestedAliases = deviceQualifierAliases.get(requestedDevice) ?? [];
    const identifiesRequestedDeviceInIdentity = requestedAliases.some((alias) => matchesWord(deviceIdentityText, alias));
    const identifiesConflictingDeviceInIdentity = [...deviceQualifierAliases.values()].some((aliases) =>
      !deviceQualifierAliases.get(requestedDevice)?.some((requested) => aliases.includes(requested)) &&
      aliases.some((alias) => matchesWord(deviceIdentityText, alias))
    );
    const accessoryTypeIndex = nameWords.findLastIndex((word) => phoneAccessoryTypes.has(word));
    const titleQualifier = nameWords.slice(0, accessoryTypeIndex < 0 ? nameWords.length : accessoryTypeIndex)
      .findLast((word) => deviceQualifierAliases.has(word));
    if (titleQualifier) {
      const titleQualifierAliases = deviceQualifierAliases.get(titleQualifier) ?? [];
      if (!deviceQualifierAliases.get(requestedDevice)?.some((alias) => titleQualifierAliases.includes(alias))) return false;
    }
    if (identifiesConflictingDeviceInIdentity && !identifiesRequestedDeviceInIdentity) return false;
  }
  const descriptionWords = words(product.description?.slice(0, 300) ?? '');
  const descriptionBoundary = descriptionWords.findIndex((word) =>
    ['for', 'with', 'compatible', 'supports', 'fits', 'works', 'includes', 'included', 'sold'].includes(word)
  );
  const descriptionLead = descriptionBoundary < 0 ? descriptionWords : descriptionWords.slice(0, descriptionBoundary);
  const descriptionIdentifiesType = itemType && matchesWord(descriptionLead, itemType);
  if (itemType && !matchesWord(itemText, itemType) && !descriptionIdentifiesType) return false;
  const categoryWords = words(product.category ?? '');
  const isHandsetCategory = categoryWords.includes('smartphones') ||
    (categoryWords.some((word) => matchesWord([word], 'phone')) &&
      !categoryWords.some((word) => ['accessory', 'accessories', 'case', 'cases'].includes(word)));
  if (itemType && phoneAccessoryTypes.has(itemType) && isHandsetCategory) return false;
  const accessoryIntent = itemType === 'accessory' || itemType === 'accessories';
  if (accessoryIntent && !categoryWords.some((word) => word.includes('accessor')) &&
    !nameWords.some((word) => word.includes('accessor') || phoneAccessoryTypes.has(word) || accessoryHeadTypes.has(word))) return false;
  if (hasAlternativeItemTypes && !alternativeBranches.some(({ type, prefixWords }) => {
    if (!matchesWord(itemText, type) && !matchesWord(descriptionLead, type)) return false;
    const requestedDeviceForBranch = prefixWords.findLast((word) => deviceQualifierAliases.has(word));
    if (requestedDeviceForBranch) {
      const aliases = deviceQualifierAliases.get(requestedDeviceForBranch) ?? [];
      const identifiesRequestedInTitle = aliases.some((alias) => matchesWord(deviceIdentityText, alias));
      const identifiesConflictingInTitle = [...deviceQualifierAliases.values()].some((otherAliases) =>
        !aliases.some((alias) => otherAliases.includes(alias)) &&
        otherAliases.some((alias) => matchesWord(deviceIdentityText, alias))
      );
      const accessoryTypeIndex = nameWords.findLastIndex((word) => phoneAccessoryTypes.has(word));
      const titleQualifier = nameWords.slice(0, accessoryTypeIndex < 0 ? nameWords.length : accessoryTypeIndex)
        .findLast((word) => deviceQualifierAliases.has(word));
      if (titleQualifier) {
        const titleQualifierAliases = deviceQualifierAliases.get(titleQualifier) ?? [];
        if (!aliases.some((alias) => titleQualifierAliases.includes(alias))) return false;
      }
      if (identifiesConflictingInTitle && !identifiesRequestedInTitle) return false;
    }
    const requestedTerms = prefixWords.filter((word) =>
      !productTypes.has(word) && !genericItemModifiers.has(word) &&
      !knownDeviceFamilyWords.has(word) && !modelQualifiers.has(word) && !/\d/.test(word) &&
      /^[a-z]{2,}$/.test(word)
    );
    if (requestedTerms.some((term) => !matchesWord(identityWords, term))) return false;
    const handsetType = type === 'phone' || type === 'phones' || type === 'smartphone' || type === 'smartphones';
    if (handsetType && !isHandsetCategory && !matchesWord(nameWords.slice(-1), 'phone')) return false;
    if (phoneAccessoryTypes.has(type) && isHandsetCategory) return false;
    if ((type === 'accessory' || type === 'accessories') && !categoryWords.some((word) => word.includes('accessor')) &&
      !nameWords.some((word) => word.includes('accessor') || phoneAccessoryTypes.has(word) || accessoryHeadTypes.has(word))) return false;
    if (!categoryWords.some((word) => matchesWord([word], type)) &&
      nameWords.some((word) => accessoryHeadTypes.has(word) && !matchesWord([word], type))) return false;
    if (!phoneAccessoryTypes.has(type) && nameWords.some((word) => accessoryHeadTypes.has(word))) return false;
    return true;
  })) return false;

  // A description can identify an otherwise untitled item, but it must not
  // override a different product type stated in the title.
  if (itemType && !matchesWord([...nameWords, ...categoryWords], itemType) &&
    nameWords.some((word) => productTypes.has(word))) return false;

  // A compatible-item mention cannot turn an accessory into the item itself.
  if (itemType && !categoryWords.some((word) => matchesWord([word], itemType)) &&
    nameWords.some((word) => accessoryHeadTypes.has(word) && !matchesWord([word], itemType))) return false;

  // Category and compatibility text may mention the requested device, but an
  // accessory title still describes the thing being sold.
  if (itemType && !accessoryIntent && !phoneAccessoryTypes.has(itemType) &&
    nameWords.some((word) => accessoryHeadTypes.has(word))) return false;

  // Brands after "for" describe compatibility (for example, a case for
  // Samsung), rather than the accessory's manufacturer.
  const requestedIdentityTerms = hasAlternativeItemTypes
    ? []
    : itemTypeIndex < 0
    ? itemWords.filter((word) => knownBrandWords.has(word))
    : itemPrefixWords.filter((word) =>
      !productTypes.has(word) && !genericItemModifiers.has(word) &&
      !knownDeviceFamilyWords.has(word) && !modelQualifiers.has(word) && !/\d/.test(word) &&
      /^[a-z]{2,}$/.test(word)
    );
  const compatibilityWords = words([product.name, product.description].filter(Boolean).join(' '));
  if (requestedIdentityTerms.some((term) => !matchesWord(identityWords, term))) return false;
  const compatibilityIndex = coreWords.indexOf('for', itemWords.length);
  const compatibilityEnd = coreWords.findIndex((word, index) => index > compatibilityIndex && detailBoundary.has(word));
  const compatibilityTerms = compatibilityIndex < 0 ? [] : coreWords.slice(
    compatibilityIndex + 1,
    compatibilityEnd < 0 ? coreWords.length : compatibilityEnd
  )
    .filter((word) => !['a', 'an', 'the', 'phone', 'phones', 'device', 'devices'].includes(word));
  if (compatibilityTerms.some((term) => knownBrandWords.has(term) || knownDeviceFamilyWords.has(term))) {
    if (!hasConsecutiveWords(compatibilityWords, compatibilityTerms)) return false;
    const compatibilityAnchor = compatibilityTerms.findIndex((word) => /\d/.test(word));
    if (compatibilityAnchor >= 0) {
      const productAnchor = compatibilityWords.findIndex((word, index) =>
        matchesWord([word], compatibilityTerms[compatibilityAnchor] ?? '') &&
        hasConsecutiveWords(compatibilityWords.slice(index), compatibilityTerms.slice(compatibilityAnchor))
      );
      if (productAnchor >= 0) {
        const queryQualifiers = compatibilityTerms.slice(compatibilityAnchor + 1).filter((word) => modelQualifiers.has(word));
        const productQualifiers: string[] = [];
        for (let next = productAnchor + 1; modelQualifiers.has(compatibilityWords[next] ?? ''); next += 1) {
          productQualifiers.push(compatibilityWords[next] ?? '');
        }
        if (productQualifiers.some((qualifier) => !queryQualifiers.includes(qualifier))) return false;
      }
    }
  }

  // "Phone pouch" describes an accessory, even if its description mentions
  // phones. A handset must be catalogued or named as the actual item.
  if (itemType === 'phone' || itemType === 'phones' || itemType === 'smartphone' || itemType === 'smartphones') {
    if (!isHandsetCategory &&
      !matchesWord(nameWords.slice(-1), 'phone')) return false;

    const modifier = itemWords[itemWords.indexOf(itemType) - 1];
    if (modifier && /^[a-z]+$/.test(modifier) && !genericPhoneModifiers.has(modifier) &&
      !matchesWord(itemText, modifier)) return false;
  }

  const productSpecWords = words([product.name, product.brand, product.category, product.description].filter(Boolean).join(' '));
  for (const [coreIndex, token] of coreWords.entries()) {
    if (/^\d+(?:gb|tb|mb|mah|w|hz|mp|ram)$/.test(token)) {
      if (!matchesProductToken(productSpecWords, token)) return false;
      const nextToken = coreWords[coreIndex + 1];
      const requestedContext = nextToken === 'ram' || nextToken === 'memory' || nextToken === 'storage'
        ? nextToken
        : undefined;
      if (requestedContext) {
        const matchingContext = productSpecWords.some((word, tokenIndex) => {
          if (!matchesWord([word], token)) return false;
          const forwardWords = productSpecWords.slice(tokenIndex + 1, tokenIndex + 3);
          const reverseWords = productSpecWords.slice(Math.max(0, tokenIndex - 2), tokenIndex);
          return matchesWord(forwardWords, requestedContext) || matchesWord(reverseWords, requestedContext);
        });
        if (!matchingContext) return false;
      }
      continue;
    }
    const index = itemWords.indexOf(token);
    if (index < 0 || !/\d/.test(token) || token.length < 2 || token.length > 10 || /^[0-9][gk]$/.test(token)) continue;
    if (!matchesProductToken(itemText, token)) return false;
    const preceding = coreWords[index - 1];
    if (preceding && /^[a-z]+$/.test(preceding) && !modelAnchorStopwords.has(preceding) &&
      !matchesWord(itemText, preceding)) return false;
    for (let next = index + 1; modelQualifiers.has(coreWords[next]); next += 1) {
      if (!matchesWord(identityWords, coreWords[next])) return false;
    }
    const productAnchorIndex = identityWords.findIndex((word) => word === token);
    if (productAnchorIndex >= 0) {
      const queryQualifiers: string[] = [];
      for (let next = index + 1; modelQualifiers.has(coreWords[next]); next += 1) queryQualifiers.push(coreWords[next]);
      const productQualifiers: string[] = [];
      for (let next = productAnchorIndex + 1; modelQualifiers.has(identityWords[next]); next += 1) productQualifiers.push(identityWords[next]);
      if (productQualifiers.some((qualifier) => !queryQualifiers.includes(qualifier))) return false;
    }
  }
  return true;
}
