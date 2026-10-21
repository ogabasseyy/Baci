import {
  emptySearchRefinements,
  mergeAssistedRefinements,
  parseSearchRefinements,
  type RefinementParams,
  type SearchAssistanceProposal,
} from '@baci/shared/lib';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Alert, Keyboard } from 'react-native';
import {
  MAX_SEARCH_QUERY_LENGTH,
  MIN_SEARCH_QUERY_LENGTH,
} from '@/constants/search';
import { isSearchableQuery } from './is-searchable-query';
import { parseRouteSearchQuery } from './parse-route-search-query';
import { useSearchRefinements } from './use-search-refinements';
import { useSearchRouteQuerySync } from './use-search-route-query-sync';

interface UseSearchScreenQueryInput {
  isFocused: boolean;
  routeQueryParam: string | string[] | undefined;
  routeParams: RefinementParams;
  writeParams: (params: RefinementParams) => void;
  evaluateCommit: (value: string) => boolean;
  noteQueryChange: (value: string) => void;
  clearHint: () => void;
  saveToHistory: (query: string) => void;
}

// Owns the search screen's query lifecycle: the typed query, its 250 ms
// debounced auto-commit, route-query application/clearing, bounded commits,
// refinement criteria, and assisted-refinement application. Extracted from
// app/search.tsx so the route component stays under the 300-line cap.
export function useSearchScreenQuery({
  isFocused,
  routeQueryParam,
  routeParams,
  writeParams,
  evaluateCommit,
  noteQueryChange,
  clearHint,
  saveToHistory,
}: UseSearchScreenQueryInput) {
  const routeQuery = parseRouteSearchQuery(routeQueryParam);
  const [query, setQuery] = useState(routeQuery ?? '');
  const activeQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState(routeQuery ?? '');
  // A committed query also has to survive product-search normalization:
  // punctuation-only input passes the length check but the fetch would
  // resolve it to zero matches. Gating here (rather than per submit
  // path) covers typed commits, debounced typing, and recent searches
  // uniformly: unsearchable input stays on the idle screen instead of
  // presenting a misleading no-results journey.
  const hasSearchQuery =
    debouncedQuery.length >= MIN_SEARCH_QUERY_LENGTH &&
    isSearchableQuery(debouncedQuery);
  const {
    criteria: refinements,
    commit: commitRefinements,
    setCriteria: setRefinements,
    invalidFilters,
    isRestoring,
  } = useSearchRefinements(debouncedQuery, routeParams, writeParams);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelDebounce = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  };

  const appliedRouteQuery = useRef(false);
  useEffect(() => {
    if (!isFocused) return;
    debounceTimerRef.current = setTimeout(() => {
      appliedRouteQuery.current = true;
      setDebouncedQuery(activeQuery);
      debounceTimerRef.current = null;
    }, 250);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [activeQuery, isFocused]);

  // Route-owned query application: each submitted route query lands in
  // history exactly once, and starts from unrefined results — refinements
  // from a previous query must not narrow the newly arrived one. The sync
  // hook below drives these callbacks. (The display-only view mode is not
  // a refinement and is preserved.)
  const applyRouteQuery = useEffectEvent((nextQuery: string) => {
    if (nextQuery === debouncedQuery && appliedRouteQuery.current) return;
    appliedRouteQuery.current = true;
    cancelDebounce();
    setQuery(nextQuery);
    setDebouncedQuery(nextQuery);
    const parsed = parseSearchRefinements(routeParams);
    setRefinements(parsed.success ? parsed.data : emptySearchRefinements());
    clearHint();
    saveToHistory(nextQuery);
  });
  const clearRouteQuery = useEffectEvent(() => {
    cancelDebounce();
    setQuery('');
    setDebouncedQuery('');
    setRefinements(emptySearchRefinements());
    clearHint();
  });
  useSearchRouteQuerySync({
    routeQueryParam,
    onApplyRouteQuery: applyRouteQuery,
    onClearRouteQuery: clearRouteQuery,
  });

  // Bound at acceptance so over-long pastes can never reach the debounced
  // auto-commit, history, or the search RPC from this screen either.
  const handleQueryChange = (value: string) => {
    const boundedValue = value.slice(0, MAX_SEARCH_QUERY_LENGTH);
    setQuery(boundedValue);
    noteQueryChange(boundedValue);
  };

  const commitSearchQuery = (value: string, recordHistory = true) => {
    appliedRouteQuery.current = true;
    const trimmedValue = value.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
    cancelDebounce();

    setQuery(trimmedValue);
    setDebouncedQuery(trimmedValue);
    if (evaluateCommit(trimmedValue) && recordHistory) {
      saveToHistory(trimmedValue);
    }
    Keyboard.dismiss();
  };

  const applyAssistance = (proposal: SearchAssistanceProposal) => {
    try {
      const next = mergeAssistedRefinements(
        refinements,
        proposal,
        debouncedQuery
      );
      cancelDebounce();
      writeParams({
        q: proposal.query,
        brand: next.brands,
        category: next.categoryId,
        condition: next.condition,
        minPrice: next.minPrice?.toString(),
        maxPrice: next.maxPrice?.toString(),
        minRating: next.minRating?.toString(),
        processor: next.processor,
        sort: next.sort,
      });
      Keyboard.dismiss();
    } catch {
      Alert.alert(
        'Check your filters',
        'These suggestions conflict with your current price range. Edit your filters and try again.'
      );
    }
  };

  return {
    query,
    setQuery,
    debouncedQuery,
    hasSearchQuery,
    handleQueryChange,
    commitSearchQuery,
    cancelDebounce,
    applyAssistance,
    refinements,
    commitRefinements,
    invalidFilters,
    isRestoring,
  };
}
