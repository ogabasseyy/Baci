import { buildProductSearchQuery } from '@baci/shared';
import {
  buildRefinedSearchHref,
  emptySearchRefinements,
  parseSearchRefinements,
  type RefinementParams,
  type SearchRefinements,
} from '@baci/shared/lib';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

function toParams(
  query: string,
  criteria: SearchRefinements
): RefinementParams {
  return {
    q: query,
    brand: criteria.brands.length ? criteria.brands : undefined,
    category: criteria.categoryId,
    condition: criteria.condition,
    processor: criteria.processor,
    minPrice: criteria.minPrice?.toString(),
    maxPrice: criteria.maxPrice?.toString(),
    minRating: criteria.minRating?.toString(),
    sort: criteria.sort === 'relevance' ? undefined : criteria.sort,
  };
}
export function useSearchRefinements(
  query: string,
  routeParams: RefinementParams,
  writeParams: (params: RefinementParams) => void
) {
  const parsed = parseSearchRefinements(routeParams);
  const normalized = buildProductSearchQuery(query).normalized;
  const routeKey = JSON.stringify(routeParams);
  const [state, setState] = useState(() => ({
    criteria: parsed.success ? parsed.data : emptySearchRefinements(),
    invalidFilters: !parsed.success,
    normalized,
    routeKey,
  }));
  const pendingRouteQuery = useRef<string | null>(null);
  const pendingWrite = useRef<RefinementParams | null>(null);
  const write = useEffectEvent(writeParams);
  let current = state;
  if (state.routeKey !== routeKey) {
    pendingRouteQuery.current =
      typeof routeParams.q === 'string'
        ? buildProductSearchQuery(routeParams.q).normalized
        : '';
    current = {
      criteria: parsed.success ? parsed.data : emptySearchRefinements(),
      invalidFilters: !parsed.success,
      normalized,
      routeKey,
    };
    setState(current);
  } else if (state.normalized !== normalized) {
    const restoring = pendingRouteQuery.current === normalized;
    pendingRouteQuery.current = null;
    current = {
      ...state,
      normalized,
      ...(restoring
        ? {}
        : { criteria: emptySearchRefinements(), invalidFilters: false }),
    };
    if (!restoring) pendingWrite.current = toParams(query, current.criteria);
    setState(current);
  }
  useEffect(() => {
    if (pendingWrite.current) {
      const params = pendingWrite.current;
      pendingWrite.current = null;
      write(params);
    }
  });
  const commit = (next: SearchRefinements) => {
    const sorted = { ...next, brands: [...new Set(next.brands)].sort() };
    if (
      buildRefinedSearchHref('', query, sorted) ===
        buildRefinedSearchHref('', query, current.criteria) &&
      !current.invalidFilters
    )
      return;
    setState({ ...current, criteria: sorted, invalidFilters: false });
    writeParams(toParams(query, sorted));
  };
  const setCriteria = (criteria: SearchRefinements) =>
    setState((value) => ({ ...value, criteria }));
  return {
    criteria: current.criteria,
    commit,
    setCriteria,
    invalidFilters: current.invalidFilters,
    isRestoring:
      pendingRouteQuery.current !== null &&
      pendingRouteQuery.current !== normalized,
  };
}
