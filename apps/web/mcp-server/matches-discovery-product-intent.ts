import {
  accessoryHeadTypes,
  detailBoundary,
  deviceQualifierAliases,
  genericItemModifiers,
  genericPhoneModifiers,
  genericTypes,
  hasConsecutiveWords,
  type IntentBranch,
  type IntentWordScope,
  joinSpecToken,
  knownBrandWords,
  knownDeviceFamilyWords,
  matchesAlternativeBranch,
  matchesProductToken,
  matchesRequestedDevice,
  matchesWord,
  modelAnchorStopwords,
  modelQualifiers,
  phoneAccessoryTypes,
  type ProductText,
  productTypes,
  words,
} from './matches-discovery-product-intent-words';

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

  // Lower-bound phrases ("over 500000") end the product-intent portion just
  // like upper bounds do, but only when a number follows: "from Samsung"
  // still describes the item rather than a price.
  const priceBoundary = queryWords.findIndex((word, index) =>
    word === 'under' || word === 'below' || word === 'between' ||
    ((word === 'over' || word === 'above' || word === 'from') && /^\d/.test(queryWords[index + 1] ?? ''))
  );
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
  // A shared noun ("Dell or ASUS laptop") types every coordinated phrase, so a
  // phrase without its own type inherits the nearest one, trailing first.
  const phraseTypeIndexes = alternativePhrases.map((phrase) =>
    phrase.findLastIndex((word) => productTypes.has(word)));
  const sharedTypeFor = (phraseIndex: number): string | undefined => {
    const indexes = [...Array(alternativePhrases.length).keys()]
      .filter((index) => index !== phraseIndex)
      .sort((a, b) =>
        Math.abs(a - phraseIndex) - Math.abs(b - phraseIndex) || b - a);
    for (const index of indexes) {
      const typeIndex = phraseTypeIndexes[index] ?? -1;
      if (typeIndex >= 0) return alternativePhrases[index]?.[typeIndex];
    }
    return undefined;
  };
  const alternativeBranches: IntentBranch[] = alternativePhrases.length > 1
    ? alternativePhrases.flatMap((phrase, phraseIndex) => {
      const typeIndex = phraseTypeIndexes[phraseIndex] ?? -1;
      if (typeIndex >= 0) {
        return [{ type: phrase[typeIndex] ?? '', prefixWords: phrase.slice(0, typeIndex), phraseWords: phrase }];
      }
      const sharedType = sharedTypeFor(phraseIndex);
      return sharedType ? [{ type: sharedType, prefixWords: phrase, phraseWords: phrase }] : [];
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
  const categoryWords = words(product.category ?? '');
  const deviceIdentityText = words([product.name, product.category].filter(Boolean).join(' '));
  const descriptionWords = words(product.description?.slice(0, 300) ?? '');
  const descriptionBoundary = descriptionWords.findIndex((word) =>
    ['for', 'with', 'compatible', 'supports', 'fits', 'works', 'includes', 'included', 'sold'].includes(word)
  );
  const descriptionLead = descriptionBoundary < 0 ? descriptionWords : descriptionWords.slice(0, descriptionBoundary);
  // Descriptive modifiers ("business", "noise cancelling") may live in the
  // category or description lead instead of the name; unknown brands still
  // fail because they appear in none of these fields.
  const identityScope = [...identityWords, ...categoryWords, ...descriptionLead];
  const isHandsetCategory = categoryWords.includes('smartphones') ||
    (categoryWords.some((word) => matchesWord([word], 'phone')) &&
      !categoryWords.some((word) => ['accessory', 'accessories', 'case', 'cases'].includes(word)));
  const scope: IntentWordScope = {
    categoryWords, descriptionLead, deviceIdentityText, identityScope, identityWords,
    isHandsetCategory, itemText, nameWords,
  };
  const itemPrefixWords = itemTypeIndex < 0 ? itemWords : itemWords.slice(0, itemTypeIndex);
  const requestedDevice = hasAlternativeItemTypes
    ? undefined
    : itemPrefixWords.findLast((word) => deviceQualifierAliases.has(word));
  if (!matchesRequestedDevice(requestedDevice, scope)) return false;
  const descriptionIdentifiesType = itemType && matchesWord(descriptionLead, itemType);
  if (itemType && !matchesWord(itemText, itemType) && !descriptionIdentifiesType) return false;
  if (itemType && phoneAccessoryTypes.has(itemType) && isHandsetCategory) return false;
  const accessoryIntent = itemType === 'accessory' || itemType === 'accessories';
  if (accessoryIntent && !categoryWords.some((word) => word.includes('accessor')) &&
    !nameWords.some((word) => word.includes('accessor') || phoneAccessoryTypes.has(word) || accessoryHeadTypes.has(word))) return false;
  const matchedBranches = hasAlternativeItemTypes
    ? alternativeBranches.filter((branch) => matchesAlternativeBranch(branch, scope))
    : [];
  if (hasAlternativeItemTypes && matchedBranches.length === 0) return false;
  const tokenInMatchedBranch = (token: string) =>
    matchedBranches.some((branch) => branch.phraseWords.includes(token));

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
  // Identity terms can also trail the type ("laptop from Samsung"); "from" and
  // "by" are markers rather than terms. Alternatives validate per branch.
  const itemSuffixWords = itemTypeIndex < 0 ? [] : itemWords.slice(itemTypeIndex + 1);
  const trailingIdentityTerms = itemSuffixWords.filter((word) =>
    word !== 'from' && word !== 'by' && !productTypes.has(word) && !genericItemModifiers.has(word) &&
    !knownDeviceFamilyWords.has(word) && !modelQualifiers.has(word) && !/\d/.test(word) &&
    /^[a-z]{2,}$/.test(word)
  );
  const compatibilityWords = words([product.name, product.description].filter(Boolean).join(' '));
  if (requestedIdentityTerms.some((term) => !matchesWord(identityScope, term))) return false;
  if (trailingIdentityTerms.some((term) => !matchesWord(identityScope, term))) return false;
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
    const nextWord = coreWords[coreIndex + 1];
    const specToken = joinSpecToken(token, nextWord);
    if (specToken) {
      // A number from one alternative must not constrain another branch's match.
      if (hasAlternativeItemTypes && itemWords.includes(token) && !tokenInMatchedBranch(token)) continue;
      if (!matchesProductToken(productSpecWords, specToken)) return false;
      const contextWord = specToken === token ? nextWord : coreWords[coreIndex + 2];
      const requestedContext = contextWord === 'ram' || contextWord === 'memory' || contextWord === 'storage'
        ? contextWord
        : undefined;
      if (requestedContext) {
        const specParts = /^(\d+)([a-z]+)$/.exec(specToken);
        const matchingContext = productSpecWords.some((word, tokenIndex) => {
          const atSpecAnchor = matchesWord([word], specToken) ||
            Boolean(specParts && word === specParts[1] && productSpecWords[tokenIndex + 1] === specParts[2]);
          if (!atSpecAnchor) return false;
          const forwardWords = productSpecWords.slice(tokenIndex + 1, tokenIndex + 4);
          const reverseWords = productSpecWords.slice(Math.max(0, tokenIndex - 2), tokenIndex);
          return matchesWord(forwardWords, requestedContext) || matchesWord(reverseWords, requestedContext);
        });
        if (!matchingContext) return false;
      }
      continue;
    }
    const index = itemWords.indexOf(token);
    if (index < 0 || !/\d/.test(token) || token.length < 2 || token.length > 10 || /^[0-9][gk]$/.test(token)) continue;
    if (hasAlternativeItemTypes && !tokenInMatchedBranch(token)) continue;
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
