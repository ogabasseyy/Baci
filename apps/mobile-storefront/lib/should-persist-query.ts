import type { Query, QueryClient } from '@tanstack/react-query';

// Never written to device storage: the PiggyVest wallet activity list is
// money history that grows with "Show more" and must start from one page.
const NEVER_PERSISTED_QUERY_KEYS = new Set(['piggyvest-wallet-activity']);

/** Which queries survive an app relaunch: successful ones, bar the list above. */
export function shouldPersistQuery(query: Query): boolean {
  const root = Array.isArray(query.queryKey) ? query.queryKey[0] : undefined;
  if (typeof root === 'string' && NEVER_PERSISTED_QUERY_KEYS.has(root)) {
    return false;
  }
  // Don't persist failed or pending queries
  return query.state.status === 'success';
}

/**
 * Drops never-persisted queries from a restored cache. Saving filters them
 * out, but restore does not, so a snapshot saved by an older build would
 * otherwise bring back every page it held (CodeRabbit, #4259).
 */
export function dropNeverPersistedQueries(client: QueryClient): void {
  for (const root of NEVER_PERSISTED_QUERY_KEYS) {
    client.removeQueries({ queryKey: [root] });
  }
}
