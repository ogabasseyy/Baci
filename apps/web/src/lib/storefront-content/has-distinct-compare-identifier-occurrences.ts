import type { PublishedClusterPost } from './content-cluster-types';
import { findCleanIdentifierEnd } from './find-clean-identifier-end';
import { getPostTokenGroups } from './get-post-token-groups';
import { isVariantOnlyComparisonSegment } from './is-variant-only-comparison-segment';
import { normalizeContentCurrencyTokens } from './normalize-content-currency-tokens';

const COMPARISON_BOUNDARY_TOKENS = new Set([
  'against',
  'and',
  'or',
  'versus',
  'vs',
]);

function tokenizeIdentifier(identifier: string) {
  return normalizeContentCurrencyTokens(identifier)
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

function countIdentifierOccurrences(tokens: string[], identifier: string) {
  const identifierTokens = tokenizeIdentifier(identifier);
  if (identifierTokens.length === 0) {
    return 0;
  }

  return tokens.filter(
    (_, index) =>
      findCleanIdentifierEnd(tokens, identifierTokens, index) !== null
  ).length;
}

function isIdentifierInternalBoundary(
  tokens: string[],
  boundaryIndex: number,
  identifiers: string[]
) {
  return identifiers.some((identifier) => {
    const identifierTokens = tokenizeIdentifier(identifier);
    return tokens.some((_, startIndex) => {
      const identifierEnd = findCleanIdentifierEnd(
        tokens,
        identifierTokens,
        startIndex
      );
      return (
        identifierEnd !== null &&
        startIndex <= boundaryIndex &&
        boundaryIndex < identifierEnd - 1
      );
    });
  });
}

function getComparisonSegments(tokens: string[], identifiers: string[]) {
  return tokens.reduce<string[][]>(
    (segments, token, index) => {
      if (
        COMPARISON_BOUNDARY_TOKENS.has(token) &&
        !isIdentifierInternalBoundary(tokens, index, identifiers)
      ) {
        segments.push([]);
      } else {
        segments.at(-1)?.push(token);
      }
      return segments;
    },
    [[]]
  );
}

function getComparisonSegmentMatches(segments: string[][], identifier: string) {
  const identifierTokens = tokenizeIdentifier(identifier);
  const matches: boolean[] = [];
  let previousSegmentCounted = false;
  for (const [index, segment] of segments.entries()) {
    const hasIdentifier = countIdentifierOccurrences(segment, identifier) > 0;
    const previousSegment = segments[index - 1] ?? [];
    const hasSplitIdentifier = identifierTokens.some((_, splitIndex) => {
      if (splitIndex === 0) {
        return false;
      }
      const prefix = identifierTokens.slice(0, splitIndex).join(' ');
      const suffix = identifierTokens.slice(splitIndex).join(' ');
      return (
        countIdentifierOccurrences(previousSegment, prefix) > 0 &&
        countIdentifierOccurrences(segment, suffix) > 0
      );
    });
    const isVariantOnlyContinuation =
      !hasIdentifier &&
      isVariantOnlyComparisonSegment(segment) &&
      (previousSegmentCounted || hasSplitIdentifier);
    const matched = hasIdentifier || isVariantOnlyContinuation;
    matches.push(matched);
    if (matched) {
      previousSegmentCounted = true;
    } else {
      previousSegmentCounted = false;
    }
  }
  return matches;
}

function hasDistinctRequirementAssignments(
  segmentMatches: boolean[][],
  requirementIndex = 0,
  usedSegments = new Set<number>()
): boolean {
  if (requirementIndex >= segmentMatches.length) {
    return true;
  }
  return segmentMatches[requirementIndex].some(
    (matched, segmentIndex) =>
      matched &&
      !usedSegments.has(segmentIndex) &&
      hasDistinctRequirementAssignments(
        segmentMatches,
        requirementIndex + 1,
        new Set([...usedSegments, segmentIndex])
      )
  );
}

/** Ensures same-model compare variants are represented by separate occurrences. */
export function hasDistinctCompareIdentifierOccurrences(
  post: PublishedClusterPost,
  identifiers: string[]
) {
  const requiredCounts = new Map<string, number>();
  for (const identifier of identifiers) {
    requiredCounts.set(identifier, (requiredCounts.get(identifier) ?? 0) + 1);
  }

  return getPostTokenGroups(post).some((tokens) => {
    const comparisonSegments = getComparisonSegments(tokens, identifiers);
    const requiredIdentifiers = Array.from(requiredCounts).flatMap(
      ([identifier, count]) => Array.from({ length: count }, () => identifier)
    );
    return hasDistinctRequirementAssignments(
      requiredIdentifiers.map((identifier) =>
        getComparisonSegmentMatches(comparisonSegments, identifier)
      )
    );
  });
}
