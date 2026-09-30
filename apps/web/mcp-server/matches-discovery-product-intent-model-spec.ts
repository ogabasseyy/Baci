import {
  displayItemTypes,
  knownBrandWords,
  knownDeviceFamilyWords,
  modelAnchorStopwords,
  modelQualifiers,
} from './matches-discovery-product-intent-vocab';
import { matchesProductToken } from './matches-discovery-product-intent-product-token';
import { joinSpecToken } from './matches-discovery-product-intent-spec-token';
import { matchesWord } from './matches-discovery-product-intent-word-match';

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
      const requestedContext = ['ram', 'memory', 'storage', 'ssd', 'hdd'].find((context) =>
        contextWord === context || (contextWord?.startsWith(context) && /^\d/.test(contextWord.slice(context.length))));
      if (requestedContext) {
        const specParts = /^(\d+)([a-z]+)$/.exec(specToken);
        const matchingContext = scope.productSpecWords.some((word, tokenIndex) => {
          const atSpecAnchor = matchesWord([word], specToken) ||
            Boolean(specParts && word === specParts[1] && scope.productSpecWords[tokenIndex + 1] === specParts[2]);
          if (!atSpecAnchor) return false;
          const contextIndex = tokenIndex + (specParts && word === specParts[1] ? 2 : 1);
          let nextContext = contextIndex;
          while (/^(?:lp)?ddr\d+x?$/.test(scope.productSpecWords[nextContext] ?? '')) nextContext += 1;
          const forwardWords = scope.productSpecWords.slice(nextContext, nextContext + 1);
          let previousContext = tokenIndex - 1;
          while (/^(?:lp)?ddr\d+x?$/.test(scope.productSpecWords[previousContext] ?? '')) previousContext -= 1;
          const previousCapacity = scope.productSpecWords[previousContext - 1] ?? '';
          const reverseWords = /^\d+(?:gb|tb|mb)$/.test(previousCapacity) ||
            (['gb', 'tb', 'mb'].includes(previousCapacity) && /^\d+$/.test(scope.productSpecWords[previousContext - 2] ?? ''))
            ? [] : scope.productSpecWords.slice(Math.max(0, previousContext), previousContext + 1);
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
