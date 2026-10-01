import { isVariantOnlyComparisonSegment } from './is-variant-only-comparison-segment';
import { matchesVariantDiscriminatorTokens } from './matches-variant-discriminator-tokens';

const COMPARISON_BOUNDARY_TOKENS = new Set([
  'against',
  'and',
  'or',
  'versus',
  'vs',
]);

export function matchesIdentifierDiscriminatorSegment(
  tokens: string[],
  identifierStart: number,
  identifierEnd: number,
  discriminatorTokens: string[],
  allowPartialGroups: boolean,
  allowMissingGroups: boolean
) {
  const previousBoundary = tokens.findLastIndex(
    (token, index) =>
      index < identifierStart && COMPARISON_BOUNDARY_TOKENS.has(token)
  );
  const nextBoundary = tokens.findIndex(
    (token, index) =>
      index >= identifierEnd && COMPARISON_BOUNDARY_TOKENS.has(token)
  );
  const occurrenceTokens = tokens.slice(
    previousBoundary + 1,
    nextBoundary >= 0 ? nextBoundary : tokens.length
  );
  const matchesCurrentSegment = matchesVariantDiscriminatorTokens(
    occurrenceTokens,
    discriminatorTokens,
    allowPartialGroups,
    allowMissingGroups
  );
  if (matchesCurrentSegment || allowPartialGroups || nextBoundary < 0) {
    return matchesCurrentSegment;
  }
  const followingBoundary = tokens.findIndex(
    (token, index) =>
      index > nextBoundary && COMPARISON_BOUNDARY_TOKENS.has(token)
  );
  const followingSegment = tokens.slice(
    nextBoundary + 1,
    followingBoundary >= 0 ? followingBoundary : tokens.length
  );
  return isVariantOnlyComparisonSegment(followingSegment)
    ? matchesVariantDiscriminatorTokens(
        followingSegment,
        discriminatorTokens,
        allowPartialGroups,
        allowMissingGroups
      )
    : false;
}
