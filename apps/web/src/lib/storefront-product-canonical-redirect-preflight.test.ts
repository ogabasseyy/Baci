import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAbortSignalTimeout } from './abort-signal-timeout';
import {
  removeNativeAbortSignalTimeout,
  restoreAbortSignalTimeout,
} from './abort-signal-timeout.test-utils';
import {
  resetStorefrontPreflightRpcForTests,
  type StorefrontPreflightRpcResult,
} from './storefront-preflight-rpc';
import { getStorefrontProductCanonicalRedirectResult } from './storefront-product-canonical-redirect';
import {
  makeStorefrontPdpPreflightRow,
  rpcImplResolving,
} from './storefront-product-canonical-redirect.test-utils';
import { resolveStorefrontProductSlugResolution } from './storefront-product-slug-membership';

vi.mock('./abort-signal-timeout', { spy: true });

const BASE_OPTIONS = {
  origin: 'https://ogabassey.com',
  secret: 'test-secret',
  category: 'smartphones',
  productSlug: 'iphone-15',
};

describe('getStorefrontProductCanonicalRedirectResult preflight handling', () => {
  beforeEach(() => {
    resetStorefrontPreflightRpcForTests();
    vi.stubEnv('VERCEL_ENV', '');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    restoreAbortSignalTimeout();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('fails open on malformed canonical response bodies', async () => {
    const rpcImpl = rpcImplResolving(
      makeStorefrontPdpPreflightRow({ present: 'yes' as unknown as boolean })
    );

    await expect(
      getStorefrontProductCanonicalRedirectResult({
        ...BASE_OPTIONS,
        identifier: 'malformed-body.example',
        rpcImpl,
      })
    ).resolves.toEqual({ kind: 'unknown' });
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'parse' })
    );
  });

  it('keeps resolving when native AbortSignal.timeout is unavailable', async () => {
    removeNativeAbortSignalTimeout();
    const rpcImpl = rpcImplResolving(
      makeStorefrontPdpPreflightRow({
        match_kind: 'active',
        product_id: '55555555-5555-4555-8555-555555555555',
        product_name: 'iPhone 15',
        product_slug: 'iphone-15',
        category_slug: 'smartphones',
        category_name: 'Smartphones',
      })
    );

    await expect(
      getStorefrontProductCanonicalRedirectResult({
        ...BASE_OPTIONS,
        identifier: 'no-native-abort.example',
        rpcImpl,
      })
    ).resolves.toEqual({ kind: 'checked-no-redirect' });
    expect(rpcImpl).toHaveBeenCalledWith(
      'get_storefront_pdp_preflight',
      {
        p_identifier: 'no-native-abort.example',
        p_product_slug: 'iphone-15',
      },
      expect.any(AbortSignal)
    );
  });

  it('fails open on a canonical RPC timeout without changing real RPC-error handling', async () => {
    const rpcImpl = vi
      .fn()
      .mockRejectedValue(
        new DOMException('operation timed out', 'TimeoutError')
      );

    await expect(
      getStorefrontProductCanonicalRedirectResult({
        ...BASE_OPTIONS,
        identifier: 'canonical-timeout.example',
        rpcImpl,
      })
    ).resolves.toEqual({ kind: 'unknown' });

    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({
        reason: 'timeout',
        surface: 'product-canonical',
      })
    );
    expect(vi.mocked(createAbortSignalTimeout)).toHaveBeenCalledWith(4_000);
  });

  it('allows a slow canonical RPC response within the transport headroom', async () => {
    removeNativeAbortSignalTimeout();
    vi.useFakeTimers();

    const row = makeStorefrontPdpPreflightRow({
      match_kind: 'active',
      product_id: '55555555-5555-4555-8555-555555555555',
      product_name: 'iPhone 15',
      product_slug: 'iphone-15',
      category_slug: 'smartphones',
      category_name: 'Smartphones',
    });
    let resolveRpc: (result: StorefrontPreflightRpcResult) => void = () => {
      throw new Error('slow RPC resolver was not initialized');
    };
    const rpcImpl = vi.fn(
      (_fn: string, _args: Record<string, string>, signal: AbortSignal) =>
        new Promise<StorefrontPreflightRpcResult>((resolve, reject) => {
          const rejectOnAbort = () => {
            reject(
              new DOMException('The operation was aborted.', 'AbortError')
            );
          };

          if (signal.aborted) {
            rejectOnAbort();
            return;
          }

          signal.addEventListener('abort', rejectOnAbort, { once: true });
          resolveRpc = (result) => {
            signal.removeEventListener('abort', rejectOnAbort);
            resolve(result);
          };
        })
    );

    const resultPromise = getStorefrontProductCanonicalRedirectResult({
      ...BASE_OPTIONS,
      identifier: 'slow-canonical.example',
      rpcImpl,
    });

    // Model a response arriving after the 3s DB ceiling but before the 4s
    // client deadline without sleeping in the regression test.
    await vi.advanceTimersByTimeAsync(3_250);
    resolveRpc({ data: [row], error: null });

    await expect(resultPromise).resolves.toEqual({
      kind: 'checked-no-redirect',
    });
    expect(vi.mocked(createAbortSignalTimeout)).toHaveBeenCalledWith(4_000);
  });

  it('does not restart the membership RPC after a canonical timeout', async () => {
    removeNativeAbortSignalTimeout();
    vi.useFakeTimers();
    vi.mocked(createAbortSignalTimeout).mockClear();

    const rpcImpl = vi.fn(
      (_fn: string, _args: Record<string, string>, signal: AbortSignal) =>
        new Promise<StorefrontPreflightRpcResult>((_resolve, reject) => {
          const rejectOnAbort = () => {
            reject(
              new DOMException('The operation was aborted.', 'AbortError')
            );
          };

          if (signal.aborted) {
            rejectOnAbort();
            return;
          }

          signal.addEventListener('abort', rejectOnAbort, { once: true });
        })
    );

    const canonicalPromise = getStorefrontProductCanonicalRedirectResult({
      ...BASE_OPTIONS,
      identifier: 'sequential-timeout.example',
      rpcImpl,
    });

    await vi.advanceTimersByTimeAsync(4_000);
    await expect(canonicalPromise).resolves.toEqual({ kind: 'unknown' });

    const membershipPromise = resolveStorefrontProductSlugResolution({
      origin: BASE_OPTIONS.origin,
      identifier: 'sequential-timeout.example',
      productSlug: BASE_OPTIONS.productSlug,
      secret: BASE_OPTIONS.secret,
      rpcImpl,
    });

    // Without the timeout sentinel, this advances the membership retry's
    // separate 2s deadline and exposes the old serialized 4s + 2s behavior.
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(membershipPromise).resolves.toEqual({
      kind: 'present-or-unknown',
    });
    expect(rpcImpl).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createAbortSignalTimeout)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createAbortSignalTimeout)).toHaveBeenCalledWith(4_000);
  });

  it('keeps a real PostgREST product-read error classified as has-error', async () => {
    const rpcImpl = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'product read failed' },
    });

    await expect(
      getStorefrontProductCanonicalRedirectResult({
        ...BASE_OPTIONS,
        identifier: 'canonical-read-error.example',
        rpcImpl,
      })
    ).resolves.toEqual({ kind: 'unknown' });

    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({
        reason: 'has-error',
        surface: 'product-canonical',
        detail: 'PGRST202 product read failed',
      })
    );
  });

  // Dropped: the old "returns unknown when deployment protection returns a
  // redirect or HTML" scenario asserted on raw HTTP `Response` shapes (a 302
  // and a text/html 200) coming back from the `/api/internal` self-fetch
  // transport (`fetchImpl`). The direct-RPC transport's `rpcImpl` contract is
  // `{ data, error }`, not a `Response` — there is no HTTP redirect or
  // content-type layer left for the caller to fail open on, so the scenario
  // has no equivalent against `storefront-preflight-rpc.ts`.
});
