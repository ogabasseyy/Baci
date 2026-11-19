import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStorefrontPreflightRpcForTests } from './storefront-preflight-rpc';
import { getStorefrontProductCanonicalRedirectResult } from './storefront-product-canonical-redirect';
import { makeStorefrontPdpPreflightRow } from './storefront-product-canonical-redirect.test-utils';

const BASE = {
  origin: 'https://ogabassey.com',
  secret: 'test-secret',
};

describe('getStorefrontProductCanonicalRedirectResult memo bypass', () => {
  beforeEach(() => {
    resetStorefrontPreflightRpcForTests();
    vi.stubEnv('VERCEL_ENV', '');
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('re-verifies with a fresh RPC before emitting 308 when a memoized row mismatches the requested category', async () => {
    const rpcImpl = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          makeStorefrontPdpPreflightRow({
            match_kind: 'active',
            product_id: 'prod-1',
            product_name: 'iPhone 15',
            product_slug: 'iphone-15',
            category_slug: 'smartphones',
          }),
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          makeStorefrontPdpPreflightRow({
            match_kind: 'active',
            product_id: 'prod-1',
            product_name: 'iPhone 15',
            product_slug: 'iphone-15',
            category_slug: 'mobile-phones',
          }),
        ],
        error: null,
      });

    // Prime the 60s memo with /smartphones/iphone-15.
    await expect(
      getStorefrontProductCanonicalRedirectResult({
        ...BASE,
        identifier: 'ogabassey.com',
        category: 'smartphones',
        productSlug: 'iphone-15',
        rpcImpl,
      })
    ).resolves.toEqual({ kind: 'checked-no-redirect' });

    // Repeat hit on /smartphones/iphone-15 uses the memo (no second RPC).
    await expect(
      getStorefrontProductCanonicalRedirectResult({
        ...BASE,
        identifier: 'ogabassey.com',
        category: 'smartphones',
        productSlug: 'iphone-15',
        rpcImpl,
      })
    ).resolves.toEqual({ kind: 'checked-no-redirect' });
    expect(rpcImpl).toHaveBeenCalledTimes(1);

    // Product moved to /mobile-phones/iphone-15: must NOT emit stale 308 to /smartphones/iphone-15.
    await expect(
      getStorefrontProductCanonicalRedirectResult({
        ...BASE,
        identifier: 'ogabassey.com',
        category: 'mobile-phones',
        productSlug: 'iphone-15',
        rpcImpl,
      })
    ).resolves.toEqual({ kind: 'checked-no-redirect' });
    expect(rpcImpl).toHaveBeenCalledTimes(2);
  });
});
