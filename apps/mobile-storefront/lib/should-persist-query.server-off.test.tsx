import { describe, expect, it } from '@jest/globals';
import { dehydrate, QueryClient } from '@tanstack/react-query';
import {
  type PersistedClient,
  type Persister,
  persistQueryClientRestore,
} from '@tanstack/react-query-persist-client';
import {
  shouldPersistQuery,
  withoutNeverPersistedQueries,
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
  const activityKey = ['piggyvest-wallet-activity', 'm', 'u'];
  const persisterFor = (saved?: PersistedClient): Persister =>
    withoutNeverPersistedQueries({
      persistClient: async () => undefined,
      removeClient: async () => undefined,
      restoreClient: async () => saved,
    });

  it('restores other queries but not the saved activity list', async () => {
    const old = new QueryClient();
    old.setQueryData(activityKey, {
      pages: [{ items: [1] }, { items: [2] }, { items: [3] }],
      pageParams: [null, 'c2', 'c3'],
    });
    old.setQueryData(['products'], ['p1']);
    // An older build saved everything, with no filter.
    const saved = {
      buster: '',
      timestamp: Date.now(),
      clientState: dehydrate(old),
    };
    const restored = new QueryClient();

    await persistQueryClientRestore({
      queryClient: restored,
      persister: persisterFor(saved),
    });

    expect(restored.getQueryData(activityKey)).toBeUndefined();
    expect(restored.getQueryData(['products'])).toEqual(['p1']);
  });

  it('leaves a live activity list alone when nothing was saved', async () => {
    const client = new QueryClient();
    const live = { pages: [{ items: [1] }], pageParams: [null] };
    client.setQueryData(activityKey, live);

    await persistQueryClientRestore({
      queryClient: client,
      persister: persisterFor(undefined),
    });

    expect(client.getQueryData(activityKey)).toEqual(live);
  });
});
