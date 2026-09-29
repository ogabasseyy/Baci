import { isBroadIntentDiscoveryWord } from './broad-intent-discovery-word';
import { matchesCompatibilityClause } from './matches-discovery-product-intent-compat';
import {
  type IntentBranch,
  type IntentWordScope,
  isModelNumberPrefix,
  matchesAlternativeBranch,
  matchesIdentityTerms,
  matchesModelSpecTokens,
  matchesRequestedDevice,
  matchesWord,
  type ProductText,
  words,
} from './matches-discovery-product-intent-words';
import {
  accessoryHeadTypes,
  detailBoundary,
  deviceQualifierAliases,
  genericItemModifiers,
  genericPhoneModifiers,
  genericTypes,
  knownBrandWords,
  knownDeviceFamilyWords,
  modelQualifiers,
  phoneAccessoryTypes,
  productTypes,
  specUnitWords,
} from './matches-discovery-product-intent-vocab';

/** Keep the requested item type and explicit model attached to search results.
 * Embeddings alone can otherwise return a phone for a request for its case. */
export function matchesDiscoveryProductIntent(product: ProductText, query: string | undefined): boolean {
  if (!query) return true;
  const rawQuery = query.normalize('NFKC').toLocaleLowerCase('en').trim();
  const normalized = rawQuery
    .replace(/^\s*(?:(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:show|find|search|buy|get|recommend|suggest)(?:\s+me)?(?:\s+for)?|(?:looking|searching|shopping)\s+for|i\s+(?:want|need))(?:\s+(?:a|an|some|the))?\s+/i, '')
    .replace(/^(?:(?:a|an|any|some|the)\s+)+/i, '');
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
  // "or" always separates alternatives, but "and" only splits genuine
  // product-type lists ("phones and tablets"): descriptive conjunctions
  // ("noise cancelling and wireless earbuds") stay one intent.
  const splitConjunction = (phrase: string[]): string[][] => {
    const parts: string[][] = [];
    let current: string[] = [];
    for (const word of phrase) {
      if (word === 'and') {
        if (current.length > 0) parts.push(current);
        current = [];
      } else {
        current.push(word);
      }
    }
    if (current.length > 0) parts.push(current);
    const typedParts = parts.filter((part) => part.some((word) => productTypes.has(word)));
    // A shared trailing noun also splits brand-led conjunctions ("Dell and
    // ASUS laptops"); purely descriptive conjunctions stay one intent.
    const splittable = (part: string[]) => part.some((word) =>
      productTypes.has(word) || knownBrandWords.has(word) || knownDeviceFamilyWords.has(word));
    const split = parts.length > 1 && typedParts.length >= 1 && parts.every(splittable);
    return split ? parts : [phrase.filter((word) => word !== 'and')];
  };
  const alternativePhrases: string[][] = [];
  let currentPhrase: string[] = [];
  for (const word of itemWords) {
    if (word === 'or') {
      if (currentPhrase.length > 0) alternativePhrases.push(...splitConjunction(currentPhrase));
      currentPhrase = [];
    } else {
      currentPhrase.push(word);
    }
  }
  if (currentPhrase.length > 0) alternativePhrases.push(...splitConjunction(currentPhrase));
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
      !categoryWords.some((word) => word.includes('accessor') || phoneAccessoryTypes.has(word)));
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
  // Without a product type, every meaningful word constrains the candidate,
  // including device families ("iphone" in "find iPhone" or "galaxy s24").
  const requestedIdentityTerms = hasAlternativeItemTypes
    ? []
    : itemTypeIndex < 0
    ? itemWords.filter((word, index) =>
      !productTypes.has(word) && !genericItemModifiers.has(word) && !specUnitWords.has(word) &&
      !modelQualifiers.has(word) && !/\d/.test(word) && !isModelNumberPrefix(itemWords, index) &&
      /^[a-z]{2,}$/.test(word)
    )
    : itemPrefixWords.filter((word, index) =>
      (!productTypes.has(word) || knownDeviceFamilyWords.has(word)) && !genericItemModifiers.has(word) &&
      !specUnitWords.has(word) && !modelQualifiers.has(word) && !/\d/.test(word) &&
      !isModelNumberPrefix(itemPrefixWords, index) && /^[a-z]{2,}$/.test(word)
    );
  // Identity terms can also trail the type ("laptop from Samsung"); "from" and
  // "by" are markers rather than terms. Alternatives validate per branch.
  const itemSuffixWords = itemTypeIndex < 0 ? [] : itemWords.slice(itemTypeIndex + 1);
  const trailingIdentityTerms = itemSuffixWords.filter((word, index) =>
    word !== 'from' && word !== 'by' && (!productTypes.has(word) || knownDeviceFamilyWords.has(word)) &&
    !genericItemModifiers.has(word) && !specUnitWords.has(word) && !modelQualifiers.has(word) &&
    !/\d/.test(word) && !isModelNumberPrefix(itemSuffixWords, index) && /^[a-z]{2,}$/.test(word)
  );
  const compatibilityWords = words([product.name, product.description].filter(Boolean).join(' '));
  if (!matchesIdentityTerms(requestedIdentityTerms, scope)) return false;
  if (!matchesIdentityTerms(trailingIdentityTerms, scope)) return false;
  // "Android" constrains the platform for handset-seeking queries: Apple
  // handsets never qualify. Catalog text usually omits the OS, so anything
  // else keeps its existing checks instead of requiring the word.
  const seeksHandset = !itemType || itemType === 'phone' || itemType === 'phones' ||
    itemType === 'smartphone' || itemType === 'smartphones';
  if (seeksHandset && coreWords.includes('android') && identityWords.some((word) =>
    word === 'apple' || word === 'iphone' || word === 'iphones' || word === 'ios')) return false;
  // Model qualifiers constrain the candidate even without a numeric anchor
  // ("MacBook Pro" is not a MacBook Air); alternatives scope them per branch.
  const qualifierWords = hasAlternativeItemTypes
    ? matchedBranches.flatMap((branch) => branch.phraseWords)
    : itemWords;
  if (qualifierWords.some((word) => modelQualifiers.has(word) && !matchesWord(identityWords, word))) return false;
  // Brands after a compatibility introducer describe the target device (for
  // example, a case for Samsung), rather than the accessory's manufacturer.
  const compatibility = matchesCompatibilityClause({ compatibilityWords, coreWords, itemWords });
  if (!compatibility.matched) return false;

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
  // Feature words after a detail boundary ("touchscreen" in "laptop with
  // touchscreen") must appear in the product text. Compatibility targets,
  // specs, and broad use-case words are validated by their own checks.
  const featureWords = coreWords.slice(itemWords.length).filter((word, offset) => {
    // Compatibility targets are validated by their own clause, including
    // unmatched "or" branches, so they never count as required features.
    const index = itemWords.length + offset;
    if (index >= compatibility.start && index < compatibility.end) return false;
    return !detailBoundary.has(word) && !genericItemModifiers.has(word) && !genericTypes.has(word) &&
      !specUnitWords.has(word) && !['a', 'an', 'the', 'phone', 'phones', 'device', 'devices'].includes(word) &&
      !/\d/.test(word) && !isBroadIntentDiscoveryWord(word) && /^[a-z]{2,}$/.test(word);
  });
  if (featureWords.some((term) => !matchesWord(productSpecWords, term))) return false;
  return matchesModelSpecTokens({
    coreWords, hasAlternativeItemTypes, identityWords, itemText, itemType, itemWords,
    matchedBranchPhrases: matchedBranches.map((branch) => branch.phraseWords), productSpecWords,
  });
}
