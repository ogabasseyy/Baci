import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontPreflightRpcImpl } from './storefront-preflight-rpc';
import { resetStorefrontPreflightRpcForTests } from './storefront-preflight-rpc';
import { getStorefrontProductCanonicalRedirectResult } from './storefront-product-canonical-redirect';
import {
  makeStorefrontPdpPreflightRow,
  overEncodedSlug,
  rpcImplResolving,
} from './storefront-product-canonical-redirect.test-utils';

const BASE = {
  origin: 'https://ogabassey.com',
  secret: 'test-secret',
};

describe('getStorefrontProductCanonicalRedirectResult', () => {
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

  it('returns unknown and skips the RPC for unsafe (over-encoded) product slugs', async () => {
    const rpcImpl = vi.fn();

    const result = await getStorefrontProductCanonicalRedirectResult({
      ...BASE,
      identifier: 'unsafe-product-slug.example',
      category: 'smartphones',
      productSlug: overEncodedSlug(),
      rpcImpl: rpcImpl as unknown as StorefrontPreflightRpcImpl,
    });

    expect(result).toEqual({ kind: 'unknown' });
    expect(rpcImpl).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(
      '[storefront-internal-preflight] skip',
      expect.objectContaining({
        surface: 'product-canonical',
        reason: 'over-encoded',
      })
    );
  });

  it('returns unknown and skips the RPC for over-long category segments', async () => {
    const rpcImpl = vi.fn();

    const result = await getStorefrontProductCanonicalRedirectResult({
      ...BASE,
      identifier: 'unsafe-category.example',
      category: 'c'.repeat(600),
      productSlug: 'iphone-15',
      rpcImpl: rpcImpl as unknown as StorefrontPreflightRpcImpl,
    });

    expect(result).toEqual({ kind: 'unknown' });
    expect(rpcImpl).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(
      '[storefront-internal-preflight] skip',
      expect.objectContaining({
        surface: 'product-canonical',
        reason: 'too-long',
      })
    );
  });

  it('returns unknown and fails open without calling rpcImpl when the secret is missing', async () => {
    const rpcImpl = vi.fn();

    const result = await getStorefrontProductCanonicalRedirectResult({
      ...BASE,
      identifier: 'no-secret.example',
      category: 'smartphones',
      productSlug: 'iphone-15',
      secret: undefined,
      rpcImpl: rpcImpl as unknown as StorefrontPreflightRpcImpl,
    });

    expect(result).toEqual({ kind: 'unknown' });
    expect(rpcImpl).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'no-secret' })
    );
  });

  it('returns unknown when the RPC transport rejects', async () => {
    // The transport already logs its own fail-open reason; this suite only
    // asserts the caller's fail-open verdict.
    const rpcImpl = vi.fn().mockRejectedValue(new Error('network unreachable'));

    const result = await getStorefrontProductCanonicalRedirectResult({
      ...BASE,
      identifier: 'transport-error.example',
      category: 'smartphones',
      productSlug: 'iphone-15',
      rpcImpl: rpcImpl as unknown as StorefrontPreflightRpcImpl,
    });

    expect(result).toEqual({ kind: 'unknown' });
  });

  it('returns unknown when the RPC row fails schema validation', async () => {
    const rpcImpl = rpcImplResolving(
      makeStorefrontPdpPreflightRow({ present: 'yes' as unknown as boolean })
    );

    const result = await getStorefrontProductCanonicalRedirectResult({
      ...BASE,
      identifier: 'schema-fail.example',
      category: 'smartphones',
      productSlug: 'iphone-15',
      rpcImpl,
    });

    expect(result).toEqual({ kind: 'unknown' });
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'parse' })
    );
  });

  it.each([
    'unknown',
    'unpublished',
  ])('returns unknown and skips for a %s storefront status', async (storefront_status) => {
    const rpcImpl = rpcImplResolving(
      makeStorefrontPdpPreflightRow({ storefront_status })
    );

    const result = await getStorefrontProductCanonicalRedirectResult({
      ...BASE,
      identifier: `storefront-status-${storefront_status}.example`,
      category: 'smartphones',
      productSlug: 'iphone-15',
      rpcImpl,
    });

    expect(result).toEqual({ kind: 'unknown' });
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] skip',
      expect.objectContaining({ reason: 'unknown-storefront' })
    );
  });

  it('returns unknown when the RPC found no active or alias match', async () => {
    const rpcImpl = rpcImplResolving(
      makeStorefrontPdpPreflightRow({
        match_kind: 'none',
        product_id: null,
        product_name: null,
      })
    );

    const result = await getStorefrontProductCanonicalRedirectResult({
      ...BASE,
      identifier: 'no-match.example',
      category: 'smartphones',
      productSlug: 'missing-product',
      rpcImpl,
    });

    expect(result).toEqual({ kind: 'unknown' });
  });

  it('returns checked-no-redirect for an active match already at its canonical path', async () => {
    const rpcImpl = rpcImplResolving(
      makeStorefrontPdpPreflightRow({
        match_kind: 'active',
        product_id: '33333333-3333-4333-8333-333333333333',
        product_name: 'Tecno Spark 40',
        product_slug: 'tecno-spark-40',
        category_slug: 'smartphones',
        category_name: 'Smartphones',
      })
    );

    const result = await getStorefrontProductCanonicalRedirectResult({
      ...BASE,
      identifier: 'active-canonical.example',
      category: 'smartphones',
      productSlug: 'tecno-spark-40',
      rpcImpl,
    });

    expect(result).toEqual({ kind: 'checked-no-redirect' });
    expect(rpcImpl).toHaveBeenCalledWith(
      'get_storefront_pdp_preflight',
      {
        p_identifier: 'active-canonical.example',
        p_product_slug: 'tecno-spark-40',
      },
      expect.any(AbortSignal)
    );
  });

  it('returns a redirect to the canonical category when the requested category is wrong', async () => {
    const rpcImpl = rpcImplResolving(
      makeStorefrontPdpPreflightRow({
        match_kind: 'active',
        product_id: '33333333-3333-4333-8333-333333333333',
        product_name: 'Tecno Spark 40',
        product_slug: 'tecno-spark-40',
        category_slug: 'smartphones',
        category_name: 'Smartphones',
      })
    );

    const result = await getStorefrontProductCanonicalRedirectResult({
      ...BASE,
      identifier: 'active-wrong-category.example',
      category: 'tecno',
      productSlug: 'tecno-spark-40',
      rpcImpl,
    });

    expect(result).toEqual({
      kind: 'redirect',
      redirectPath: '/smartphones/tecno-spark-40',
    });
  });

  it('redirects a categoryless PDP to its relation-backed category when the direct category id is null', async () => {
    const rpcImpl = rpcImplResolving(
      makeStorefrontPdpPreflightRow({
        match_kind: 'active',
        product_id: '5e2fe9d9-dee5-47b4-9bdc-55c8224a7222',
        product_name: 'Google Pixel 6 Pro',
        product_slug: 'google-pixel-6-pro',
        category_id: null,
        category_name: 'Smartphones',
        category_slug: 'smartphones',
      })
    );

    const result = await getStorefrontProductCanonicalRedirectResult({
      ...BASE,
      identifier: 'ogabassey',
      category: 'products',
      productSlug: 'google-pixel-6-pro',
      rpcImpl,
    });

    expect(result).toEqual({
      kind: 'redirect',
      redirectPath: '/smartphones/google-pixel-6-pro',
    });
  });
});
