import type { Query, QueryKey } from '@tanstack/react-query';
import type { Persister } from '@tanstack/react-query-persist-client';

// Never written to device storage: the PiggyVest wallet activity list is
// money history that grows with "Show more" and must start from one page.
const NEVER_PERSISTED_QUERY_KEYS = new Set(['piggyvest-wallet-activity']);

function isNeverPersistedKey(queryKey: QueryKey): boolean {
  const root = Array.isArray(queryKey) ? queryKey[0] : undefined;
  return typeof root === 'string' && NEVER_PERSISTED_QUERY_KEYS.has(root);
}

/** Which queries survive an app relaunch: successful ones, bar the list above. */
export function shouldPersistQuery(query: Query): boolean {
  if (isNeverPersistedKey(query.queryKey)) return false;
  // Don't persist failed or pending queries
  return query.state.status === 'success';
}

/**
 * Wraps a persister so a saved snapshot never brings back the queries above.
 * Saving already skips them, but a snapshot from an older build may still
 * hold every activity page. Filtering before hydration leaves any live query
 * alone (CodeRabbit, #4259).
 */
export function withoutNeverPersistedQueries(persister: Persister): Persister {
  return {
    persistClient: (client) => persister.persistClient(client),
    removeClient: () => persister.removeClient(),
    restoreClient: async () => {
      const saved = await persister.restoreClient();
      if (!saved) return saved;
      return {
        ...saved,
        clientState: {
          ...saved.clientState,
          queries: saved.clientState.queries.filter(
            (query) => !isNeverPersistedKey(query.queryKey)
          ),
        },
      };
    },
  };
}
