export type ProductText = {
  brand?: string | null;
  category?: string | null;
  description?: string | null;
  name?: string | null;
};

import {
  accessoryHeadTypes,
  deviceQualifierAliases,
  displayItemTypes,
  equivalentTerms,
  genericItemModifiers,
  irregularPlurals,
  irregularSingulars,
  knownBrandWords,
  knownDeviceFamilyWords,
  modelAnchorStopwords,
  modelQualifiers,
  phoneAccessoryTypes,
  productTypes,
  specUnitWords,
} from './matches-discovery-product-intent-vocab';

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
  if (compactUnit && textWords.some((word, index) =>
    word === compactUnit[1] && textWords[index + 1] === compactUnit[2])) return true;
  // Punctuation-split spellings ("WH-1000XM5" vs "WH1000XM5", "USB-C" vs "USBC").
  return textWords.some((word, index) =>
    index + 1 < textWords.length && `${word}${textWords[index + 1]}` === token);
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
  if (/^\d+$/.test(token) && nextWord && specUnitWords.has(nextWord)) return `${token}${nextWord}`;
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

/** A short word glued to a model number ("wh" in "WH-1000XM5") is validated
 * by model matching, not as an identity term. */
export function isModelNumberPrefix(words: string[], index: number): boolean {
  const word = words[index] ?? '';
  const next = words[index + 1];
  return word.length <= 3 && Boolean(next && /\d/.test(next));
}

/** Recognized brands must match the name or brand field, so a competitor
 * mentioned in marketing copy cannot satisfy an explicit brand request.
 * Descriptive modifiers may also match the category or description lead. */
export function matchesIdentityTerms(terms: string[], scope: IntentWordScope): boolean {
  return terms.every((term) =>
    matchesWord(knownBrandWords.has(term) ? scope.identityWords : scope.identityScope, term));
}

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
  const requestedTerms = prefixWords.filter((word, index) =>
    (!productTypes.has(word) || knownDeviceFamilyWords.has(word)) && !genericItemModifiers.has(word) &&
    !specUnitWords.has(word) && !modelQualifiers.has(word) && !/\d/.test(word) &&
    !isModelNumberPrefix(prefixWords, index) && /^[a-z]{2,}$/.test(word)
  );
  if (!matchesIdentityTerms(requestedTerms, scope)) return false;
  // A branch matches only when its own model/spec numbers fit the candidate,
  // so "iPhone 15 case or iPhone 14 case" narrows to one branch per product.
  for (const [position, token] of prefixWords.entries()) {
    if (!/\d/.test(token) || token.length > 10) continue;
    // Network generations ("5g") always constrain; resolutions ("4k") only
    // constrain display items, since bare "4k" can also mean a price. Version
    // fragments ("4g" in "2.4g") never constrain on their own.
    const branchGeneration = /^[0-9]([gk])$/.exec(token)?.[1];
    const branchVersionFragment = /^\d/.test(prefixWords[position - 1] ?? '');
    if (branchGeneration && (branchVersionFragment ||
      (branchGeneration === 'k' && !displayItemTypes.has(type)))) continue;
    if (token.length < 2) {
      const neighbors = [prefixWords[position - 1], prefixWords[position + 1]];
      const attachedToFamily = neighbors.some((word) => word &&
        (knownDeviceFamilyWords.has(word) || knownBrandWords.has(word)));
      if (!attachedToFamily) continue;
    }
    const spec = joinSpecToken(token, prefixWords[position + 1]);
    if (spec) {
      if (!matchesProductToken(scope.identityScope, spec)) return false;
      continue;
    }
    const branchPreceding = position > 0 ? prefixWords[position - 1] : undefined;
    const alphaBranchPreceding = branchPreceding && /^[a-z]+$/.test(branchPreceding) &&
      !modelAnchorStopwords.has(branchPreceding) ? branchPreceding : undefined;
    if (!matchesProductToken(scope.itemText, token) &&
      !(alphaBranchPreceding && matchesWord(scope.itemText, `${alphaBranchPreceding}${token}`))) return false;
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

export type ModelSpecScope = {
  coreWords: string[];
  hasAlternativeItemTypes: boolean;
  identityWords: string[];
  itemText: string[];
  itemType: string | undefined;
  itemWords: string[];
  matchedBranchPhrases: string[][];
  productSpecWords: string[];
};

/** Validate numeric model anchors and specification tokens. Alternative
 * queries scope each number to its matching branch; hyphenated models match
 * their compact spelling ("WH-1000XM5" vs "WH1000XM5"). */
export function matchesModelSpecTokens(scope: ModelSpecScope): boolean {
  const tokenInMatchedBranch = (token: string) =>
    scope.matchedBranchPhrases.some((phrase) => phrase.includes(token));
  for (const [coreIndex, token] of scope.coreWords.entries()) {
    const nextWord = scope.coreWords[coreIndex + 1];
    const specToken = joinSpecToken(token, nextWord);
    if (specToken) {
      // A number from one alternative must not constrain another branch's match.
      if (scope.hasAlternativeItemTypes && scope.itemWords.includes(token) && !tokenInMatchedBranch(token)) continue;
      if (!matchesProductToken(scope.productSpecWords, specToken)) return false;
      const contextWord = specToken === token ? nextWord : scope.coreWords[coreIndex + 2];
      const requestedContext = contextWord === 'ram' || contextWord === 'memory' || contextWord === 'storage'
        ? contextWord
        : undefined;
      if (requestedContext) {
        const specParts = /^(\d+)([a-z]+)$/.exec(specToken);
        const matchingContext = scope.productSpecWords.some((word, tokenIndex) => {
          const atSpecAnchor = matchesWord([word], specToken) ||
            Boolean(specParts && word === specParts[1] && scope.productSpecWords[tokenIndex + 1] === specParts[2]);
          if (!atSpecAnchor) return false;
          const forwardWords = scope.productSpecWords.slice(tokenIndex + 1, tokenIndex + 4);
          const reverseWords = scope.productSpecWords.slice(Math.max(0, tokenIndex - 2), tokenIndex);
          return matchesWord(forwardWords, requestedContext) || matchesWord(reverseWords, requestedContext);
        });
        if (!matchingContext) return false;
      }
      continue;
    }
    const index = coreIndex < scope.itemWords.length ? coreIndex : -1;
    if (index < 0 || !/\d/.test(token) || token.length > 10) continue;
    const generation = /^[0-9]([gk])$/.exec(token)?.[1];
    const versionFragment = /^\d/.test(scope.coreWords[coreIndex - 1] ?? '');
    if (generation && (versionFragment ||
      (generation === 'k' && !(scope.itemType && displayItemTypes.has(scope.itemType))))) continue;
    if (token.length < 2) {
      // Single digits constrain only family-attached models ("Pixel 9"), never
      // incidental quantities ("2 in 1", "2 pack").
      const neighbors = [scope.coreWords[coreIndex - 1], scope.coreWords[coreIndex + 1]];
      const attachedToFamily = neighbors.some((word) => word &&
        (knownDeviceFamilyWords.has(word) || knownBrandWords.has(word)));
      if (!attachedToFamily) continue;
    }
    if (scope.hasAlternativeItemTypes && !tokenInMatchedBranch(token)) continue;
    const preceding = scope.coreWords[index - 1];
    const alphaPreceding = preceding && /^[a-z]+$/.test(preceding) && !modelAnchorStopwords.has(preceding)
      ? preceding
      : undefined;
    const joinedMatched = Boolean(alphaPreceding && matchesWord(scope.itemText, `${alphaPreceding}${token}`));
    if (!matchesProductToken(scope.itemText, token) && !joinedMatched) return false;
    if (!joinedMatched && alphaPreceding && !matchesWord(scope.itemText, alphaPreceding)) return false;
    for (let next = index + 1; modelQualifiers.has(scope.coreWords[next]); next += 1) {
      if (!matchesWord(scope.identityWords, scope.coreWords[next])) return false;
    }
    const productAnchorIndex = scope.identityWords.findIndex((word) => word === token);
    if (productAnchorIndex >= 0) {
      const queryQualifiers: string[] = [];
      for (let next = index + 1; modelQualifiers.has(scope.coreWords[next]); next += 1) {
        queryQualifiers.push(scope.coreWords[next]);
      }
      const productQualifiers: string[] = [];
      for (let next = productAnchorIndex + 1; modelQualifiers.has(scope.identityWords[next]); next += 1) {
        productQualifiers.push(scope.identityWords[next]);
      }
      if (productQualifiers.some((qualifier) => !queryQualifiers.includes(qualifier))) return false;
    }
  }
  return true;
}
