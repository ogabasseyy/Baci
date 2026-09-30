import { useState } from 'react';
import { MIN_SEARCH_QUERY_LENGTH } from '@/constants/search';
import { isSearchableQuery } from './is-searchable-query';

/**
 * Validation hint for the results-screen search input, mirroring the
 * home submission path: committing a too-short or normalization-empty
 * query explains itself instead of silently falling back to the
 * recent-searches idle screen.
 */
export function useSearchMinLengthHint() {
  const [showSearchMinLengthHint, setShowSearchMinLengthHint] = useState(false);

  const evaluateCommit = (trimmedValue: string) => {
    const committed =
      trimmedValue.length >= MIN_SEARCH_QUERY_LENGTH &&
      isSearchableQuery(trimmedValue);
    setShowSearchMinLengthHint(!committed);
    return committed;
  };

  const noteQueryChange = (boundedValue: string) => {
    if (
      showSearchMinLengthHint &&
      boundedValue.trim().length >= MIN_SEARCH_QUERY_LENGTH &&
      isSearchableQuery(boundedValue)
    ) {
      setShowSearchMinLengthHint(false);
    }
  };

  const clearHint = () => {
    setShowSearchMinLengthHint(false);
  };

  return {
    showSearchMinLengthHint,
    evaluateCommit,
    noteQueryChange,
    clearHint,
  };
}
