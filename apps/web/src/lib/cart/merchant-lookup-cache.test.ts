import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCartMerchantLookupCacheForTesting,
  cachedCartMerchantLookups,
} from './merchant-lookup-cache';
import { CART_MERCHANT_LOOKUP_TTL_MS } from './merchant-lookup-cache-constants';

const MERCHANT_ROW = {
  business_name: 'Oga Bassey',
  custom_domain: 'ogabassey.com',
  id: 'merchant-1',
  is_published: true,
  slug: 'ogabassey',
};
const FEATURE_ROW = {
  plan_expires_at: null,
  plan_tier: 'pro',
  premium_features: ['shared_cart'],
};

type Reply = { data: unknown; error: unknown };

function fakeClient(options: {
  rpc?: () => Reply | Promise<Reply>;
  features?: () => Reply | Promise<Reply>;
}) {
  const rpc = vi.fn(
    async () => options.rpc?.() ?? { data: [MERCHANT_ROW], error: null }
  );
  const maybeSingle = vi.fn(
    async () => options.features?.() ?? { data: FEATURE_ROW, error: null }
  );
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle }) }),
  }));
  return {
    client: { from, rpc } as unknown as SupabaseClient,
    maybeSingle,
    rpc,
  };
}

const ARGS = { p_identifier: 'ogabassey.com' };

describe('cart merchant lookup cache', () => {
  beforeEach(() => {
    __resetCartMerchantLookupCacheForTesting();
  });

  it('reuses a published merchant row within the window, across clients', async () => {
    const first = fakeClient({});
    const second = fakeClient({});
    const now = vi.fn(() => 1_000);

    const reply = await cachedCartMerchantLookups(
      first.client,
      now
    ).rpcClient.rpc('resolve_storefront_auth_merchant', ARGS);
    const repeat = await cachedCartMerchantLookups(
      second.client,
      now
    ).rpcClient.rpc('resolve_storefront_auth_merchant', ARGS);

    expect(reply).toEqual({ data: [MERCHANT_ROW], error: null });
    expect(repeat).toEqual({ data: [MERCHANT_ROW], error: null });
    expect(first.rpc).toHaveBeenCalledTimes(1);
    expect(second.rpc).not.toHaveBeenCalled();
  });

  it('reads the merchant again once the window has passed', async () => {
    const { client, rpc } = fakeClient({});
    let time = 1_000;
    const lookups = cachedCartMerchantLookups(client, () => time);

    await lookups.rpcClient.rpc('resolve_storefront_auth_merchant', ARGS);
    time += CART_MERCHANT_LOOKUP_TTL_MS;
    await lookups.rpcClient.rpc('resolve_storefront_auth_merchant', ARGS);

    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('keeps identifiers apart', async () => {
    const { client, rpc } = fakeClient({});
    const lookups = cachedCartMerchantLookups(client, () => 1_000);

    await lookups.rpcClient.rpc('resolve_storefront_auth_merchant', ARGS);
    await lookups.rpcClient.rpc('resolve_storefront_auth_merchant', {
      p_identifier: 'another-store',
    });

    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['an error', { data: null, error: { message: 'down' } }],
    ['no row', { data: [], error: null }],
    [
      'an unpublished store',
      { data: [{ ...MERCHANT_ROW, is_published: false }], error: null },
    ],
    ['a malformed row', { data: [{ id: 7 }], error: null }],
  ])('never remembers %s', async (_label, reply) => {
    const { client, rpc } = fakeClient({ rpc: () => reply });
    const lookups = cachedCartMerchantLookups(client, () => 1_000);

    await expect(
      lookups.rpcClient.rpc('resolve_storefront_auth_merchant', ARGS)
    ).resolves.toEqual(reply);
    await lookups.rpcClient.rpc('resolve_storefront_auth_merchant', ARGS);

    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('reuses a feature row within the window and re-reads after it', async () => {
    const { client, maybeSingle } = fakeClient({});
    let time = 1_000;
    const lookups = cachedCartMerchantLookups(client, () => time);

    await expect(lookups.features('merchant-1')).resolves.toEqual(FEATURE_ROW);
    await expect(lookups.features('merchant-1')).resolves.toEqual(FEATURE_ROW);
    expect(maybeSingle).toHaveBeenCalledTimes(1);

    time += CART_MERCHANT_LOOKUP_TTL_MS;
    await lookups.features('merchant-1');
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });

  it('never remembers a missing feature row or a failed lookup', async () => {
    const missing = fakeClient({
      features: () => ({ data: null, error: null }),
    });
    const lookups = cachedCartMerchantLookups(missing.client, () => 1_000);
    await expect(lookups.features('merchant-2')).resolves.toBeNull();
    await expect(lookups.features('merchant-2')).resolves.toBeNull();
    expect(missing.maybeSingle).toHaveBeenCalledTimes(2);

    const failing = fakeClient({
      features: () => ({ data: null, error: { message: 'down' } }),
    });
    const failingLookups = cachedCartMerchantLookups(
      failing.client,
      () => 1_000
    );
    await expect(failingLookups.features('merchant-3')).rejects.toThrow(
      'merchant feature lookup failed'
    );
    await expect(failingLookups.features('merchant-3')).rejects.toThrow(
      'merchant feature lookup failed'
    );
    expect(failing.maybeSingle).toHaveBeenCalledTimes(2);
  });

  it('shares one round trip between concurrent identical reads', async () => {
    let release: (reply: Reply) => void = () => {};
    const pending = new Promise<Reply>((resolve) => {
      release = resolve;
    });
    const { client, rpc } = fakeClient({ rpc: () => pending });
    const lookups = cachedCartMerchantLookups(client, () => 1_000);

    const a = lookups.rpcClient.rpc('resolve_storefront_auth_merchant', ARGS);
    const b = lookups.rpcClient.rpc('resolve_storefront_auth_merchant', ARGS);
    await Promise.resolve();
    release({ data: [MERCHANT_ROW], error: null });

    await expect(Promise.all([a, b])).resolves.toEqual([
      { data: [MERCHANT_ROW], error: null },
      { data: [MERCHANT_ROW], error: null },
    ]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
