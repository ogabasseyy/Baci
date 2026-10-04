import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storefrontComparePageStatusFastPath } from './storefront-compare-page-status-fast-path';
import { resetStorefrontPreflightRpcForTests } from './storefront-preflight-rpc';

const { resolve, resetForTests } = storefrontComparePageStatusFastPath;

function buildOptions(
  identifier: string,
  rpcImpl: Parameters<typeof resolve>[0]['rpcImpl']
) {
  return {
    origin: 'https://ogabassey.com',
    identifier,
    categorySlug: 'laptops',
    comparisonIsValid: false,
    rpcImpl,
    timeoutMs: 2_000,
  };
}

describe('storefront compare hard-status fast path', () => {
  beforeEach(() => {
    resetForTests();
    resetStorefrontPreflightRpcForTests();
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('coalesces concurrent publication probes for the same storefront', async () => {
    let resolveRpc: (result: { data: unknown; error: null }) => void = () =>
      undefined;
    const rpcImpl = vi.fn(
      () =>
        new Promise<{ data: unknown; error: null }>((resolveResult) => {
          resolveRpc = resolveResult;
        })
    );

    const requests = Array.from({ length: 12 }, () =>
      resolve(buildOptions('ogabassey', rpcImpl))
    );

    await Promise.resolve();
    expect(rpcImpl).toHaveBeenCalledTimes(1);

    resolveRpc({ data: [{ is_published: true }], error: null });

    await expect(Promise.all(requests)).resolves.toEqual(
      Array.from({ length: 12 }, () => ({ kind: 'missing' }))
    );
  });

  it('caps concurrent probes for distinct storefronts and fails excess open', async () => {
    const resolveRpcs: Array<(result: { data: unknown; error: null }) => void> =
      [];
    const rpcImpl = vi.fn(
      () =>
        new Promise<{ data: unknown; error: null }>((resolveResult) => {
          resolveRpcs.push(resolveResult);
        })
    );

    const requests = Array.from({ length: 12 }, (_, index) =>
      resolve(buildOptions(`storefront-${index}`, rpcImpl))
    );

    await Promise.resolve();
    expect(rpcImpl).toHaveBeenCalledTimes(8);
    expect(resolveRpcs).toHaveLength(8);
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] skip',
      expect.objectContaining({ reason: 'concurrency-limit' })
    );

    for (const resolveRpc of resolveRpcs) {
      resolveRpc({ data: [{ is_published: true }], error: null });
    }

    await expect(Promise.all(requests)).resolves.toEqual([
      ...Array.from({ length: 8 }, () => ({ kind: 'missing' })),
      ...Array.from({ length: 4 }, () => ({ kind: 'renderable-or-unknown' })),
    ]);
  });

  it('fails open on a publication RPC error and releases the probe slot', async () => {
    const rpcImpl = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'XX000', message: 'database unavailable' },
    });

    await expect(
      resolve(buildOptions('storefront-error', rpcImpl))
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });
    await expect(
      resolve(buildOptions('storefront-error', rpcImpl))
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });

    expect(rpcImpl).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'has-error' })
    );
  });
});
