import { describe, expect, it } from '@jest/globals';
import { dehydrate, QueryClient } from '@tanstack/react-query';
import { persistQueryClientRestore } from '@tanstack/react-query-persist-client';
import {
  dropNeverPersistedQueries,
  shouldPersistQuery,
} from './should-persist-query';

const query = (queryKey: unknown[], status = 'success') =>
  ({ queryKey, state: { status } }) as unknown as Parameters<
    typeof shouldPersistQuery
  >[0];

describe('bugfix: the expanded wallet activity list survived an app relaunch', () => {
  it('never persists the wallet activity list', () => {
    expect(
      shouldPersistQuery(query(['piggyvest-wallet-activity', 'm', 'u']))
    ).toBe(false);
  });

  it('still persists other successful queries and skips failed ones', () => {
    expect(shouldPersistQuery(query(['products']))).toBe(true);
    expect(shouldPersistQuery(query(['products'], 'error'))).toBe(false);
  });
});

describe('bugfix: an older saved snapshot restored every activity page', () => {
  it('removes the restored activity list and keeps other queries', async () => {
    const saved = new QueryClient();
    const activityKey = ['piggyvest-wallet-activity', 'm', 'u'];
    saved.setQueryData(activityKey, {
      pages: [{ items: [1] }, { items: [2] }, { items: [3] }],
      pageParams: [null, 'c2', 'c3'],
    });
    saved.setQueryData(['products'], ['p1']);
    // An older build saved everything, with no filter.
    const clientState = dehydrate(saved);
    const restored = new QueryClient();
    await persistQueryClientRestore({
      queryClient: restored,
      persister: {
        persistClient: async () => undefined,
        removeClient: async () => undefined,
        restoreClient: async () => ({
          buster: '',
          timestamp: Date.now(),
          clientState,
        }),
      },
    });
    expect(restored.getQueryData(activityKey)).toBeDefined();

    dropNeverPersistedQueries(restored);

    expect(restored.getQueryData(activityKey)).toBeUndefined();
    expect(restored.getQueryData(['products'])).toEqual(['p1']);
  });
});
