'use client';

import { recordSearchSubmission } from '@/lib/search-submission';
import { DidYouMeanBanner } from './did-you-mean-banner';

interface ProductGridDidYouMeanProps {
  didYouMean: string | null;
  searchQuery: string;
  basePath: string;
  onSelectSuggestion: (suggestion: string) => void;
}

/** Did-you-mean correction with explicit-submission tracking attached. */
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
