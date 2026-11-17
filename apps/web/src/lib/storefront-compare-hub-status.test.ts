import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CompareHubStatusResolver,
  clearStorefrontCompareHubStatusCache,
  resolveStorefrontCompareHubStatus,
} from './storefront-compare-hub-status';

function buildOptions(
  resolverImpl: CompareHubStatusResolver,
  overrides: Partial<
    Parameters<typeof resolveStorefrontCompareHubStatus>[0]
  > = {}
) {
  return {
    origin: 'https://ogabassey.com',
    identifier: 'ogabassey',
    categorySlug: 'printers',
    secret: 'test-internal-secret',
    resolverImpl,
    ...overrides,
  };
}

describe('resolveStorefrontCompareHubStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clearStorefrontCompareHubStatusCache();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves empty for a confirmed-empty hub verdict in-process without fetch', async () => {
    const resolverImpl = vi.fn().mockResolvedValue({ kind: 'empty' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const resolution = await resolveStorefrontCompareHubStatus(
      buildOptions(resolverImpl)
    );

    expect(resolution).toEqual({ kind: 'empty' });
    expect(resolverImpl).toHaveBeenCalledWith({
      merchantSlug: 'ogabassey',
      categorySlug: 'printers',
      signal: expect.any(AbortSignal),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not cache empty verdicts so a newly stocked hub serves 200 immediately', async () => {
    const resolverImpl = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'empty' })
      .mockResolvedValueOnce({ kind: 'renderable', merchantId: 'merchant-1' });

    await expect(
      resolveStorefrontCompareHubStatus(buildOptions(resolverImpl))
    ).resolves.toEqual({ kind: 'empty' });

    await expect(
      resolveStorefrontCompareHubStatus(buildOptions(resolverImpl))
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });
    expect(resolverImpl).toHaveBeenCalledTimes(2);
  });

  it('resolves renderable for a non-empty hub verdict and caches for 60 seconds', async () => {
    const resolverImpl = vi
      .fn()
      .mockResolvedValue({ kind: 'renderable', merchantId: 'merchant-1' });

    await expect(
      resolveStorefrontCompareHubStatus(buildOptions(resolverImpl))
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });

    vi.advanceTimersByTime(59_999);
    await expect(
      resolveStorefrontCompareHubStatus(buildOptions(resolverImpl))
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });
    expect(resolverImpl).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    await expect(
      resolveStorefrontCompareHubStatus(buildOptions(resolverImpl))
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });
    expect(resolverImpl).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent identical lookups via SingleFlight', async () => {
    let resolve: ((value: { kind: 'empty' }) => void) | undefined;
    let started: (() => void) | undefined;
    const lookupStarted = new Promise<void>((done) => {
      started = done;
    });
    const resolverImpl = vi.fn().mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
          started?.();
        })
    );

    const first = resolveStorefrontCompareHubStatus(buildOptions(resolverImpl));
    const second = resolveStorefrontCompareHubStatus(
      buildOptions(resolverImpl, {
        identifier: ' OGABASSEY ',
        categorySlug: ' Printers ',
      })
    );

    await lookupStarted;
    resolve?.({ kind: 'empty' });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'empty' },
      { kind: 'empty' },
    ]);
    expect(resolverImpl).toHaveBeenCalledTimes(1);
    expect(resolverImpl).toHaveBeenCalledWith({
      merchantSlug: 'ogabassey',
      categorySlug: 'printers',
      signal: expect.any(AbortSignal),
    });
  });

  it('normalizes whitespace/case before resolver invocation in reversed order', async () => {
    let resolve: ((value: { kind: 'empty' }) => void) | undefined;
    let started: (() => void) | undefined;
    const lookupStarted = new Promise<void>((done) => {
      started = done;
    });
    const resolverImpl = vi.fn().mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
          started?.();
        })
    );

    const first = resolveStorefrontCompareHubStatus(
      buildOptions(resolverImpl, {
        identifier: ' OGABASSEY ',
        categorySlug: ' Printers ',
      })
    );
    const second = resolveStorefrontCompareHubStatus(
      buildOptions(resolverImpl)
    );

    await lookupStarted;
    resolve?.({ kind: 'empty' });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'empty' },
      { kind: 'empty' },
    ]);
    expect(resolverImpl).toHaveBeenCalledTimes(1);
    expect(resolverImpl).toHaveBeenCalledWith({
      merchantSlug: 'ogabassey',
      categorySlug: 'printers',
      signal: expect.any(AbortSignal),
    });
  });

  it('fails open when the secret is missing without calling the resolver', async () => {
    const resolverImpl = vi.fn();

    await expect(
      resolveStorefrontCompareHubStatus(
        buildOptions(resolverImpl, { secret: undefined })
      )
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });
    expect(resolverImpl).not.toHaveBeenCalled();
  });

  it('fails open on an unsafe category segment without calling the resolver', async () => {
    const resolverImpl = vi.fn();

    await expect(
      resolveStorefrontCompareHubStatus(
        buildOptions(resolverImpl, { categorySlug: 'a'.repeat(600) })
      )
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });
    expect(resolverImpl).not.toHaveBeenCalled();
  });

  it('fails open on resolver errors without caching the failure', async () => {
    const resolverImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('db unavailable'))
      .mockResolvedValueOnce({ kind: 'empty' });

    await expect(
      resolveStorefrontCompareHubStatus(buildOptions(resolverImpl))
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });
    await expect(
      resolveStorefrontCompareHubStatus(buildOptions(resolverImpl))
    ).resolves.toEqual({ kind: 'empty' });
    expect(resolverImpl).toHaveBeenCalledTimes(2);
  });

  it('fails open on a lookup timeout without caching the failure', async () => {
    const resolverImpl = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce({ kind: 'empty' });

    const pending = resolveStorefrontCompareHubStatus(
      buildOptions(resolverImpl, { timeoutMs: 100 })
    );
    await vi.advanceTimersByTimeAsync(101);

    await expect(pending).resolves.toEqual({ kind: 'renderable-or-unknown' });
    const firstCallArg = resolverImpl.mock.calls[0]?.[0];
    expect(firstCallArg?.signal?.aborted).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'timeout' })
    );

    await expect(
      resolveStorefrontCompareHubStatus(buildOptions(resolverImpl))
    ).resolves.toEqual({ kind: 'empty' });
    expect(resolverImpl).toHaveBeenCalledTimes(2);
  });

  it('fails open on unknown status without caching it', async () => {
    const resolverImpl = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'unknown' })
      .mockResolvedValueOnce({ kind: 'empty' });

    await expect(
      resolveStorefrontCompareHubStatus(buildOptions(resolverImpl))
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });
    await expect(
      resolveStorefrontCompareHubStatus(buildOptions(resolverImpl))
    ).resolves.toEqual({ kind: 'empty' });
    expect(resolverImpl).toHaveBeenCalledTimes(2);
  });
});
