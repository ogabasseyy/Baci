import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storefrontComparePageStatus } from './storefront-compare-page-status';
import { storefrontComparePageStatusTestHelpers } from './storefront-compare-page-status.test-helpers';
import { resetStorefrontPreflightRpcForTests } from './storefront-preflight-rpc';

const { buildOptions, jsonResponse } = storefrontComparePageStatusTestHelpers;
const {
  resolve: resolveStorefrontComparePageStatus,
  resetForTests: resetStorefrontComparePageStatusForTests,
} = storefrontComparePageStatus;

describe('resolveStorefrontComparePageStatus', () => {
  beforeEach(() => {
    resetStorefrontComparePageStatusForTests();
    resetStorefrontPreflightRpcForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns missing only for an explicit positive absence', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ present: false, hasError: false }));

    await expect(
      resolveStorefrontComparePageStatus(buildOptions(fetchImpl))
    ).resolves.toEqual({ kind: 'missing' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/internal/compare-page-status/ogabassey?category=laptops&comparison=left-laptop-vs-right-laptop',
      expect.objectContaining({
        headers: { 'x-baci-internal-auth': 'test-internal-secret' },
        redirect: 'manual',
      })
    );
  });

  it('falls through for renderable and degraded verdicts', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ present: true, hasError: false }))
      .mockResolvedValueOnce(jsonResponse({ present: false, hasError: true }));

    await expect(
      resolveStorefrontComparePageStatus(buildOptions(fetchImpl))
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });
    await expect(
      resolveStorefrontComparePageStatus(buildOptions(fetchImpl))
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });
  });

  it('coalesces concurrent requests for the same status URL', async () => {
    let resolveFetch: (response: Response) => void = () => undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const first = resolveStorefrontComparePageStatus(buildOptions(fetchImpl));
    const second = resolveStorefrontComparePageStatus(buildOptions(fetchImpl));

    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse({ present: true, hasError: false }));

    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'renderable-or-unknown' },
      { kind: 'renderable-or-unknown' },
    ]);
  });

  it('does not share an in-flight response across secret rotation', async () => {
    const resolveFetches: Array<(response: Response) => void> = [];
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetches.push(resolve);
        })
    );

    const first = resolveStorefrontComparePageStatus(buildOptions(fetchImpl));
    const second = resolveStorefrontComparePageStatus(
      buildOptions(fetchImpl, { secret: 'rotated-internal-secret' })
    );

    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(resolveFetches).toHaveLength(2);

    for (const resolveFetch of resolveFetches) {
      resolveFetch(jsonResponse({ present: true, hasError: false }));
    }

    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'renderable-or-unknown' },
      { kind: 'renderable-or-unknown' },
    ]);
  });

  it('bounds concurrent status probes and fails excess callers open', async () => {
    const resolveFetches: Array<(response: Response) => void> = [];
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetches.push(resolve);
        })
    );

    const requests = Array.from({ length: 12 }, (_, index) =>
      resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, {
          comparisonSlug: `left-${index}-vs-right-${index}`,
        })
      )
    );

    expect(fetchImpl).toHaveBeenCalledTimes(8);
    expect(resolveFetches).toHaveLength(8);
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] skip',
      expect.objectContaining({ reason: 'concurrency-limit' })
    );

    for (const resolveFetch of resolveFetches) {
      resolveFetch(jsonResponse({ present: true, hasError: false }));
    }

    await expect(Promise.all(requests)).resolves.toEqual(
      Array.from({ length: 12 }, () => ({ kind: 'renderable-or-unknown' }))
    );
    const skipWarnings = vi
      .mocked(console.warn)
      .mock.calls.filter(
        ([message, payload]) =>
          message === '[storefront-internal-preflight] skip' &&
          (payload as { reason?: string }).reason === 'concurrency-limit'
      );
    expect(skipWarnings).toHaveLength(4);
  });

  it('fails open without a secret or trusted base URL', async () => {
    const fetchImpl = vi.fn();

    await expect(
      resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, { secret: undefined })
      )
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });
    await expect(
      resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, { origin: 'https://ogabassey.com' })
      )
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('hard-statuses a bounded malformed composite as a confirmed absence', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ present: false, hasError: false }));

    await expect(
      resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, { comparisonSlug: 'not-a-comparison' })
      )
    ).resolves.toEqual({ kind: 'missing' });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it.each([
    ['transport failure', new Error('socket hang up')],
    ['timeout', new DOMException('Timed out', 'TimeoutError')],
  ])('fails open on %s', async (_label, error) => {
    const fetchImpl = vi.fn().mockRejectedValue(error);

    await expect(
      resolveStorefrontComparePageStatus(buildOptions(fetchImpl))
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });
  });

  it('opens after repeated transport failures and skips later probes', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('upstream down'));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        resolveStorefrontComparePageStatus(
          buildOptions(fetchImpl, {
            comparisonSlug: `left-${attempt}-vs-right-${attempt}`,
          })
        )
      ).resolves.toEqual({ kind: 'renderable-or-unknown' });
    }

    await expect(
      resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, {
          comparisonSlug: 'left-after-open-vs-right-after-open',
        })
      )
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] skip',
      expect.objectContaining({ reason: 'circuit-open' })
    );
  });

  it('does not open the breaker for repeated designed unknown verdicts', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ present: false, hasError: true }))
      .mockResolvedValueOnce(jsonResponse({ present: false, hasError: true }))
      .mockResolvedValueOnce(jsonResponse({ present: false, hasError: true }))
      .mockResolvedValueOnce(jsonResponse({ present: false, hasError: true }))
      .mockResolvedValueOnce(jsonResponse({ present: false, hasError: true }))
      .mockResolvedValueOnce(jsonResponse({ present: false, hasError: false }));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        resolveStorefrontComparePageStatus(
          buildOptions(fetchImpl, {
            comparisonSlug: `left-unknown-${attempt}-vs-right-${attempt}`,
          })
        )
      ).resolves.toEqual({ kind: 'renderable-or-unknown' });
    }

    await expect(
      resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, {
          comparisonSlug: 'left-healthy-vs-right-healthy',
        })
      )
    ).resolves.toEqual({ kind: 'missing' });

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(console.warn).not.toHaveBeenCalledWith(
      '[storefront-internal-preflight] skip',
      expect.objectContaining({ reason: 'circuit-open' })
    );
  });

  it('fails open on redirects, non-2xx, non-JSON, and malformed bodies', async () => {
    const redirectFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 308,
        headers: { Location: 'https://attacker.example/steal' },
      })
    );
    await expect(
      resolveStorefrontComparePageStatus(buildOptions(redirectFetch))
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });

    const httpFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401));
    await expect(
      resolveStorefrontComparePageStatus(buildOptions(httpFetch))
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });

    const nonJsonFetch = vi.fn().mockResolvedValue(new Response('not-json'));
    await expect(
      resolveStorefrontComparePageStatus(buildOptions(nonJsonFetch))
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });

    const malformedFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ present: false }));
    await expect(
      resolveStorefrontComparePageStatus(buildOptions(malformedFetch))
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });
  });
});
