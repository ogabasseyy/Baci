import type { BuildCommercialGuideLinksInput } from './content-cluster-types';
import { hasCleanIdentifierOccurrence } from './has-clean-identifier-occurrence';

/** Matches a model phrase while rejecting unbranded numeric-only references. */
export function matchesProductGuideIdentifier(
  post: BuildCommercialGuideLinksInput['posts'][number],
  inferredTokens: string[],
  identifierTokens: string[],
  hasBrandMatch: boolean,
  occurrenceOptions?: Parameters<typeof hasCleanIdentifierOccurrence>[2]
) {
  if (
    identifierTokens.length === 0 ||
    (identifierTokens.every((token) => /^\d+$/u.test(token)) &&
      !hasBrandMatch &&
      !occurrenceOptions?.brand) ||
    !identifierTokens.every((token) => inferredTokens.includes(token))
  ) {
    return false;
  }
  return hasCleanIdentifierOccurrence(
    post,
    identifierTokens,
    occurrenceOptions
  );
}
