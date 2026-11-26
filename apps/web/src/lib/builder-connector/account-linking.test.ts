// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  createBuilderAccountResolver,
  createBuilderUserClientResolver,
  readBuilderOwnedMerchant,
} from './account-linking';

const actor = '10000000-0000-4000-8000-000000000001';
const store = '20000000-0000-4000-8000-000000000001';
const identity = {
  actorUserId: actor,
  connectionId: '30000000-0000-4000-8000-000000000001',
  grantVersion: 1,
  scopes: new Set(['storefront.read', 'storefront.write'] as const),
  allowedMerchantIds: [store],
  allowCreateStore: false,
};
afterEach(() => vi.unstubAllGlobals());
it('uses only the linked bearer and live owner after getUser; never cookies', async () => {
  const seen: string[] = [];
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      expect(req.headers.get('authorization')).toBe('Bearer linked-upstream');
      seen.push(new URL(req.url).pathname);
      return Response.json(
        req.url.includes('/auth/v1/user')
          ? { id: actor, aud: 'authenticated', role: 'authenticated' }
          : [{ id: store, user_id: actor }]
      );
    }
  );
  const resolve = createBuilderAccountResolver({
    supabase: { url: 'https://fixture.supabase.co', anonKey: 'public-anon' },
    resolveLinkedAccessToken: async () => 'linked-upstream',
  });
  const ctx = await resolve(identity, store, 'update_storefront_draft');
  expect(ctx.merchantId).toBe(store);
  expect(seen).toContain('/auth/v1/user');
  expect(seen).toContain('/rest/v1/merchants');
});
it('rejects upstream account mismatch, removed ownership and unconsented selectors', async () => {
  const resolve = createBuilderAccountResolver({
    supabase: { url: 'https://fixture.supabase.co', anonKey: 'public-anon' },
    resolveLinkedAccessToken: async () => 'linked-upstream',
  });
  for (const user of [actor, store]) {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
      Response.json(String(input).includes('/auth/v1/user') ? { id: user } : [])
    );
    await expect(
      resolve(identity, store, 'get_storefront_status')
    ).rejects.toThrow();
  }
  await expect(
    resolve(
      { ...identity, allowedMerchantIds: [] },
      store,
      'get_storefront_status'
    )
  ).rejects.toThrow();
});

it('cancels the linked user verification request when the MCP call disconnects', async () => {
  const controller = new AbortController();
  const entered = Promise.withResolvers<AbortSignal>();
  vi.stubGlobal('fetch', (_input: RequestInfo | URL, init: RequestInit) => {
    if (!init.signal) throw Error('Missing upstream auth signal');
    const upstream = init.signal;
    entered.resolve(upstream);
    return new Promise((_, reject) => {
      upstream.addEventListener('abort', () => reject(upstream.reason), {
        once: true,
      });
    });
  });
  const resolve = createBuilderUserClientResolver({
    supabase: { url: 'https://fixture.supabase.co', anonKey: 'public-anon' },
    resolveLinkedAccessToken: async () => 'linked-upstream',
  });
  const response = resolve(identity, controller.signal);
  const completed = expect(response).rejects.toMatchObject({
    name: 'AbortError',
  });
  try {
    const upstream = await Promise.race([
      entered.promise,
      response.then(() => {
        throw Error('Unexpected user');
      }),
    ]);
    controller.abort();
    expect(upstream.aborted).toBe(true);
    await completed;
  } finally {
    controller.abort();
  }
});

it('binds the caller signal to the initial merchant ownership lookup', async () => {
  const { signal } = new AbortController();
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    abortSignal: vi.fn().mockReturnThis(),
    maybeSingle: async () => ({
      data: { id: store, user_id: actor },
      error: null,
    }),
  };
  await expect(
    readBuilderOwnedMerchant(
      { from: () => query } as never,
      store,
      actor,
      signal
    )
  ).resolves.toBe(store);
  expect(query.abortSignal).toHaveBeenCalledExactlyOnceWith(signal);
});
