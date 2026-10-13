import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storefrontComparePageStatus } from './storefront-compare-page-status';
import { storefrontComparePageStatusTestHelpers } from './storefront-compare-page-status.test-helpers';

const { buildOptions, jsonResponse } = storefrontComparePageStatusTestHelpers;
const {
  resolve: resolveStorefrontComparePageStatus,
  resetForTests: resetStorefrontComparePageStatusForTests,
} = storefrontComparePageStatus;

describe('compare page status breaker regressions', () => {
  beforeEach(() => {
    resetStorefrontComparePageStatusForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resets transport failures after a designed unknown verdict', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockResolvedValueOnce(jsonResponse({ present: false, hasError: true }))
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockResolvedValueOnce(jsonResponse({ present: false, hasError: false }));

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, {
          comparisonSlug: `left-failure-${attempt}-vs-right-${attempt}`,
        })
      );
    }
    await resolveStorefrontComparePageStatus(
      buildOptions(fetchImpl, {
        comparisonSlug: 'left-unknown-vs-right-unknown',
      })
    );
    await resolveStorefrontComparePageStatus(
      buildOptions(fetchImpl, {
        comparisonSlug:
          'left-after-unknown-failure-vs-right-after-unknown-failure',
      })
    );

    await expect(
      resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, {
          comparisonSlug: 'left-healthy-vs-right-healthy',
        })
      )
    ).resolves.toEqual({ kind: 'missing' });
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    expect(console.warn).not.toHaveBeenCalledWith(
      '[storefront-internal-preflight] skip',
      expect.objectContaining({ reason: 'circuit-open' })
    );
  });

  it('resets the breaker after a request-validation 400 between failures', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockResolvedValueOnce(jsonResponse({ error: 'Invalid input' }, 400))
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockResolvedValueOnce(jsonResponse({ present: false, hasError: false }));

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, {
          comparisonSlug: `left-failure-${attempt}-vs-right-failure-${attempt}`,
        })
      );
    }
    await resolveStorefrontComparePageStatus(
      buildOptions(fetchImpl, {
        categorySlug: ' ',
        comparisonSlug: 'left-invalid-vs-right-invalid',
      })
    );
    await resolveStorefrontComparePageStatus(
      buildOptions(fetchImpl, {
        comparisonSlug:
          'left-after-invalid-failure-vs-right-after-invalid-failure',
      })
    );

    await expect(
      resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, {
          comparisonSlug: 'left-healthy-vs-right-healthy',
        })
      )
    ).resolves.toEqual({ kind: 'missing' });
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    expect(console.warn).not.toHaveBeenCalledWith(
      '[storefront-internal-preflight] skip',
      expect.objectContaining({ reason: 'circuit-open' })
    );
  });

  it('opens the breaker after repeated authentication failures', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse({ present: false, hasError: false }));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, {
          comparisonSlug: `left-auth-${attempt}-vs-right-auth-${attempt}`,
        })
      );
    }

    await expect(
      resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, {
          comparisonSlug: 'left-after-auth-vs-right-after-auth',
        })
      )
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] skip',
      expect.objectContaining({ reason: 'circuit-open' })
    );
  });

  it('fails open immediately for an in-flight probe after the breaker opens', async () => {
    let resolveHangingProbe: (response: Response) => void = () => undefined;
    let callCount = 0;
    const fetchImpl = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise<Response>((resolve) => {
          resolveHangingProbe = resolve;
        });
      }
      return Promise.reject(new Error('upstream down'));
    });

    const hangingProbe = resolveStorefrontComparePageStatus(
      buildOptions(fetchImpl)
    );
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await resolveStorefrontComparePageStatus(
        buildOptions(fetchImpl, {
          comparisonSlug: `left-outage-${attempt}-vs-right-outage-${attempt}`,
        })
      );
    }

    const duplicateProbe = resolveStorefrontComparePageStatus(
      buildOptions(fetchImpl)
    );
    let resolveSentinel: (value: { source: 'sentinel' }) => void = () =>
      undefined;
    const sentinel = new Promise<{ source: 'sentinel' }>((resolve) => {
      resolveSentinel = resolve;
    });
    const duplicateRace = Promise.race([
      duplicateProbe.then((result) => ({ source: 'probe', result })),
      sentinel,
    ]);
    await Promise.resolve();
    resolveSentinel({ source: 'sentinel' });
    await expect(duplicateRace).resolves.toEqual({
      source: 'probe',
      result: { kind: 'renderable-or-unknown' },
    });

    resolveHangingProbe(jsonResponse({ present: true, hasError: false }));
    await expect(hangingProbe).resolves.toEqual({
      kind: 'renderable-or-unknown',
    });
  });
});
