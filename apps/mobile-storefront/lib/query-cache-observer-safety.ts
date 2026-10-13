import type { QueryClient } from '@tanstack/react-query';

const ACCOUNT_QUERY_PREFIXES = new Set([
  'customer',
  'orders',
  'profile',
  'receipt-detail',
  'receipts',
  'saved',
  'vtu',
  'vtu-history',
  'wallet',
  'vtu-saved-cards',
]);

function isAccountScopedQuery(query: { queryKey: readonly unknown[] }) {
  const prefix = query.queryKey[0];
  if (prefix === 'vtu') return query.queryKey[1] !== 'billers';
  return typeof prefix === 'string' && ACCOUNT_QUERY_PREFIXES.has(prefix);
}

/**
 * Clears cached account data without disconnecting mounted query observers.
 * QueryClient.clear() removes active queries and their subscribers; a mounted
 * screen can then remain in a permanent pending state until it is remounted.
 */
export function clearQueryCachePreservingObservers(
  queryClient: QueryClient,
  options: { refetchAccountQueries?: boolean } = {}
): void {
  queryClient.removeQueries({ type: 'inactive' });
  queryClient.getMutationCache().clear();

  // Clear mounted account data without issuing a request under the old
  // identity. Public observers are reset below and may safely refetch.
  const activeAccountQueries = queryClient
    .getQueryCache()
    .findAll({ type: 'active' })
    .filter(isAccountScopedQuery);
  for (const query of activeAccountQueries) {
    query.reset();
  }

  if (options.refetchAccountQueries) {
    void queryClient
      .resetQueries({ type: 'active', predicate: isAccountScopedQuery })
      .catch(() => undefined);
  }

  // Reset active observers in place, then refetch enabled public queries. This
  // clears account data while allowing the current guest screen to recover.
  void queryClient
    .resetQueries({
      type: 'active',
      predicate: (query) => !isAccountScopedQuery(query),
    })
    .catch(() => undefined);
}
