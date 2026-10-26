// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createBuilderAccountResolver } from './account-linking';

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
