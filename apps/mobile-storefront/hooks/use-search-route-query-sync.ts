import { useEffect, useRef } from 'react';
import { parseRouteSearchQuery } from './parse-route-search-query';

/**
 * Compares raw route params by value (arrays element-wise). A repeated
 * param and its joined string form are NOT equal: one is ambiguous and
 * rejected, the other is a searchable query.
 */
function isSameRouteParam(
  a: string | string[] | undefined,
  b: string | string[] | undefined
): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => value === b[index])
    );
  }
  return a === b;
}

interface UseSearchRouteQuerySyncInput {
  /** Raw Expo Router `q` param driving the sync. */
  routeQueryParam: string | string[] | undefined;
  /** Applies a newly arrived valid route query (stable callback). */
  onApplyRouteQuery: (query: string) => void;
  /** Clears search state when the route query becomes invalid (stable). */
  onClearRouteQuery: () => void;
}

/**
 * Applies a newly arrived route query to an already-mounted screen. A
 * transition to a missing or invalid route param clears the search state
 * so stale results never linger — keyed off the raw param transition, not
 * just the last applied query, so locally entered searches also clear when
 * an invalid param arrives on a parameterless-opened screen. In-screen
 * edits never change the route param, so typing after navigation is safe.
 */
export function useSearchRouteQuerySync({
  routeQueryParam,
  onApplyRouteQuery,
  onClearRouteQuery,
}: UseSearchRouteQuerySyncInput): void {
  const appliedRouteQueryRef = useRef<string | null>(null);
  // The raw param behind the last effect run. Initialized to the mount
  // value so the first run never counts as a transition.
  const prevRouteQueryParamRef = useRef<string | string[] | undefined>(
    routeQueryParam
  );

  useEffect(() => {
    const nextRouteQuery = parseRouteSearchQuery(routeQueryParam);
    const rawParamChanged = !isSameRouteParam(
      prevRouteQueryParamRef.current,
      routeQueryParam
    );
    prevRouteQueryParamRef.current = routeQueryParam;
    if (nextRouteQuery) {
      if (appliedRouteQueryRef.current !== nextRouteQuery) {
        appliedRouteQueryRef.current = nextRouteQuery;
        onApplyRouteQuery(nextRouteQuery);
      }
      return;
    }
    // The mount run is never a transition.
    if (rawParamChanged || appliedRouteQueryRef.current !== null) {
      appliedRouteQueryRef.current = null;
      onClearRouteQuery();
    }
  }, [routeQueryParam, onApplyRouteQuery, onClearRouteQuery]);
}
