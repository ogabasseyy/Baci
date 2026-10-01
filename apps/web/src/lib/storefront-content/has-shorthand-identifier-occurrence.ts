import { isVariantOnlyComparisonSegment } from './is-variant-only-comparison-segment';

const COMPARISON_BOUNDARY_TOKENS = new Set([
  'against',
  'and',
  'or',
  'versus',
  'vs',
]);
const MODEL_TIER_TOKENS = new Set([
  'active',
  'classic',
  'edge',
  'fe',
  'flip',
  'fold',
  'lite',
  'max',
  'mini',
  'neo',
  'plus',
  'power',
  'prime',
  'pro',
  'se',
  'ultra',
  'xl',
]);

function matchesTokenSequence(
  tokens: string[],
  expectedTokens: string[],
  startIndex: number
) {
  return expectedTokens.every(
    (token, offset) => tokens[startIndex + offset] === token
  );
}

/** Matches identifiers split across a model phrase and variant-only compare segment. */
export function hasShorthandIdentifierOccurrence(
  postTokens: string[],
  identifierTokens: string[],
  qualifiesOccurrence: (
    startIndex: number,
    endIndex: number,
    occurrenceTokens: string[]
  ) => boolean
) {
  if (identifierTokens.length < 2) {
    return false;
  }

  return postTokens.some((token, boundaryIndex) => {
    if (!COMPARISON_BOUNDARY_TOKENS.has(token)) {
      return false;
    }
    const previousBoundary = postTokens.findLastIndex(
      (candidate, index) =>
        index < boundaryIndex && COMPARISON_BOUNDARY_TOKENS.has(candidate)
    );
    const nextBoundary = postTokens.findIndex(
      (candidate, index) =>
        index > boundaryIndex && COMPARISON_BOUNDARY_TOKENS.has(candidate)
    );
    const leftStart = previousBoundary + 1;
    const rightSegment = postTokens.slice(
      boundaryIndex + 1,
      nextBoundary >= 0 ? nextBoundary : postTokens.length
    );
    if (!isVariantOnlyComparisonSegment(rightSegment)) {
      return false;
    }

    return identifierTokens.some((_, splitIndex) => {
      if (splitIndex === 0) {
        return false;
      }
      const prefix = identifierTokens.slice(0, splitIndex);
      const suffix = identifierTokens.slice(splitIndex);
      if (!matchesTokenSequence(rightSegment, suffix, 0)) {
        return false;
      }
      const hasUnexpectedTierSuffix = rightSegment
        .slice(suffix.length)
        .some((token) => MODEL_TIER_TOKENS.has(token));
      if (hasUnexpectedTierSuffix) {
        return false;
      }
      const prefixStart = postTokens.findIndex(
        (_, index) =>
          index >= leftStart &&
          index + prefix.length <= boundaryIndex &&
          matchesTokenSequence(postTokens, prefix, index)
      );
      return (
        prefixStart >= 0 &&
        qualifiesOccurrence(prefixStart, prefixStart + prefix.length, [
          ...postTokens.slice(leftStart, boundaryIndex),
          ...rightSegment,
        ])
      );
    });
  });
}
