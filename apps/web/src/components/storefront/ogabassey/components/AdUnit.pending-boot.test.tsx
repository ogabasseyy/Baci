import { act, render, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { ensureGoogleAdManagerBoot, ensureGoogleTag } = vi.hoisted(() => ({
  ensureGoogleAdManagerBoot: vi.fn(() => Promise.resolve()),
  ensureGoogleTag: vi.fn(() => window.googletag),
}));

vi.mock('./google-ad-bootstrap', () => ({
  ensureGoogleAdManagerBoot,
  ensureGoogleTag,
}));

import { AdUnit } from './AdUnit';

describe('AdUnit pending boot lifecycle', () => {
  beforeEach(() => {
    ensureGoogleAdManagerBoot.mockClear();
    ensureGoogleTag.mockClear();

    const slot = {
      addService: vi.fn(),
      defineSizeMapping: vi.fn(),
    };
    slot.addService.mockReturnValue(slot);
    slot.defineSizeMapping.mockReturnValue(slot);

    const sizeMappingBuilder = {
      addSize: vi.fn(),
      build: vi.fn(() => []),
    };
    sizeMappingBuilder.addSize.mockReturnValue(sizeMappingBuilder);

    const pubAdsService = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    window.googletag = {
      cmd: {
        push: (fn: () => void) => {
          fn();
          return 0;
        },
      },
      defineSlot: vi.fn(() => slot),
      pubads: vi.fn(() => pubAdsService),
      display: vi.fn(),
      destroySlots: vi.fn(),
      sizeMapping: vi.fn(() => sizeMappingBuilder),
    } as unknown as typeof window.googletag;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('restarts GPT after Suspense hides the ad before boot defines a slot', async () => {
    let resolveBoot: () => void = () => {};
    ensureGoogleAdManagerBoot.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveBoot = resolve;
        })
    );

    const suspended = new Promise<never>(() => {});
    function SuspensibleAd({ shouldSuspend }: { shouldSuspend: boolean }) {
      if (shouldSuspend) {
        throw suspended;
      }
      return (
        <AdUnit
          placementKey="HEADER_LEADERBOARD"
          isActive
          loadStrategy="immediate"
        />
      );
    }

    const { rerender } = render(
      <Suspense fallback={null}>
        <SuspensibleAd shouldSuspend={false} />
      </Suspense>
    );

    expect(ensureGoogleAdManagerBoot).toHaveBeenCalledOnce();

    rerender(
      <Suspense fallback={null}>
        <SuspensibleAd shouldSuspend />
      </Suspense>
    );

    await act(async () => {
      resolveBoot();
      await Promise.resolve();
    });

    rerender(
      <Suspense fallback={null}>
        <SuspensibleAd shouldSuspend={false} />
      </Suspense>
    );

    await waitFor(() => {
      expect(window.googletag.display).toHaveBeenCalledOnce();
    });
  });
});
