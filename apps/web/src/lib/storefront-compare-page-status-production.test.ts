import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storefrontComparePageStatus } from './storefront-compare-page-status';
import { storefrontComparePageStatusTestHelpers } from './storefront-compare-page-status.test-helpers';
import { resetStorefrontPreflightRpcForTests } from './storefront-preflight-rpc';

const { buildOptions } = storefrontComparePageStatusTestHelpers;
const {
  resolve: resolveStorefrontComparePageStatus,
  resetForTests: resetStorefrontComparePageStatusForTests,
} = storefrontComparePageStatus;

describe('storefront compare production fast path', () => {
  beforeEach(() => {
    resetStorefrontComparePageStatusForTests();
    resetStorefrontPreflightRpcForTests();
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('fails open before self-fetching from a public production origin', async () => {
    const fetchImpl = vi.fn();

    await expect(
      resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, { origin: 'https://ogabassey.com' })
      )
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  it('preserves a published storefront hard 404 for malformed public comparisons', async () => {
    const fetchImpl = vi.fn();
    const rpcImpl = vi.fn().mockResolvedValue({
      data: [{ is_published: true }],
      error: null,
    });

    await expect(
      resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, {
          origin: 'https://ogabassey.com',
          comparisonSlug: 'not-a-comparison',
          rpcImpl,
        })
      )
    ).resolves.toEqual({ kind: 'missing' });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rpcImpl).toHaveBeenCalledWith(
      'resolve_storefront_auth_merchant',
      { p_identifier: 'ogabassey' },
      expect.any(AbortSignal)
    );
  });

  it('keeps malformed public comparisons fail-open for unknown storefronts', async () => {
    const fetchImpl = vi.fn();
    const rpcImpl = vi.fn().mockResolvedValue({ data: [], error: null });

    await expect(
      resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, {
          origin: 'https://ogabassey.com',
          identifier: 'unknown-store.example',
          comparisonSlug: 'not-a-comparison',
          rpcImpl,
        })
      )
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'parse' })
    );
  });

  it('preserves a published storefront hard 404 for special collection comparisons', async () => {
    const fetchImpl = vi.fn();
    const rpcImpl = vi.fn().mockResolvedValue({
      data: [{ is_published: true }],
      error: null,
    });

    await expect(
      resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, {
          origin: 'https://ogabassey.com',
          categorySlug: 'new-arrivals',
          rpcImpl,
        })
      )
    ).resolves.toEqual({ kind: 'missing' });

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
