import type { Query } from '@tanstack/react-query';

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
