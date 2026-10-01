'use client';

import { recordSearchSubmission } from '@/lib/search-submission';
import { DidYouMeanBanner } from './did-you-mean-banner';

interface ProductGridDidYouMeanProps {
  didYouMean: string | null;
  searchQuery: string;
  basePath: string;
  onSelectSuggestion: (suggestion: string) => void;
}

/**
 * Did-you-mean correction with explicit-submission tracking attached.
 *
 * An empty basePath is safe to beacon: it only occurs under domain routing,
 * where the endpoint resolves the merchant from the host and ignores the
 * prefix. A missing merchant context renders null (no didYouMean), so this
 * component never beacons an unresolvable platform-host prefix.
 */
export function ProductGridDidYouMean({
  didYouMean,
  searchQuery,
  basePath,
  onSelectSuggestion,
}: ProductGridDidYouMeanProps) {
  if (!didYouMean || !searchQuery) {
    return null;
  }

  return (
    <DidYouMeanBanner
      originalQuery={searchQuery}
      suggestion={didYouMean}
      onSuggestionClick={(suggestion) => {
        // An explicit correction: record it through the submission path
        // while the follow-up /api/search read stays untracked.
        recordSearchSubmission(suggestion, basePath, 'did-you-mean');
        onSelectSuggestion(suggestion);
      }}
    />
  );
}
