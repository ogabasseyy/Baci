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

const setDocumentPrerendering = (value: boolean) =>
  Object.defineProperty(document, 'prerendering', {
    configurable: true,
    value,
  });

describe('AdUnit lifecycle', () => {
  let intersectionCallback: IntersectionObserverCallback | undefined;
  let pubAdsService: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    ensureGoogleAdManagerBoot.mockClear();
    ensureGoogleTag.mockClear();

    class MockIntersectionObserver {
      observe = vi.fn();
      disconnect = vi.fn();

      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
    }

    global.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;

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

    pubAdsService = {
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
    delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    Reflect.deleteProperty(document, 'prerendering');
  });

  it('keeps a loaded carousel ad slot mounted when the slide becomes inactive', async () => {
    const { rerender, unmount } = render(
      <AdUnit
        placementKey="HEADER_LEADERBOARD"
        isActive
        loadStrategy="immediate"
      />
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.googletag.defineSlot).toHaveBeenCalledOnce();
      expect(window.googletag.display).toHaveBeenCalledOnce();
    });

    rerender(
      <AdUnit
        placementKey="HEADER_LEADERBOARD"
        isActive={false}
        loadStrategy="immediate"
      />
    );

    expect(window.googletag.destroySlots).not.toHaveBeenCalled();
    expect(pubAdsService.removeEventListener).not.toHaveBeenCalled();

    rerender(
      <AdUnit
        placementKey="HEADER_LEADERBOARD"
        isActive
        loadStrategy="immediate"
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(window.googletag.defineSlot).toHaveBeenCalledOnce();
    expect(window.googletag.display).toHaveBeenCalledOnce();
    expect(window.googletag.destroySlots).not.toHaveBeenCalled();

    unmount();

    expect(pubAdsService.removeEventListener).toHaveBeenCalledWith(
      'slotRenderEnded',
      expect.any(Function)
    );
  });

  it('destroys GPT before React removes the slot container during navigation', async () => {
    const slotContainerPresence: boolean[] = [];
    window.googletag.destroySlots = vi.fn(() => {
      slotContainerPresence.push(
        document.getElementById('div-gpt-ad-header') !== null
      );
      return true;
    });

    const { unmount } = render(
      <AdUnit
        placementKey="HEADER_LEADERBOARD"
        isActive
        loadStrategy="immediate"
      />
    );

    await waitFor(() => {
      expect(window.googletag.display).toHaveBeenCalledOnce();
    });

    unmount();

    expect(slotContainerPresence).toEqual([true]);
  });

  it('does not define a slot when boot resolves after unmount', async () => {
    let resolveBoot: () => void = () => {};
    ensureGoogleAdManagerBoot.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveBoot = resolve;
        })
    );

    const { unmount } = render(
      <AdUnit
        placementKey="HEADER_LEADERBOARD"
        isActive
        loadStrategy="immediate"
      />
    );

    expect(ensureGoogleAdManagerBoot).toHaveBeenCalledOnce();

    unmount();

    await act(async () => {
      resolveBoot();
      await Promise.resolve();
    });

    expect(window.googletag.defineSlot).not.toHaveBeenCalled();
    expect(window.googletag.display).not.toHaveBeenCalled();
  });

  it('does not bootstrap GPT for a discarded prerender before route activation', async () => {
    setDocumentPrerendering(true);

    const { unmount } = render(
      <AdUnit
        placementKey="HEADER_LEADERBOARD"
        isActive
        loadStrategy="immediate"
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(ensureGoogleAdManagerBoot).not.toHaveBeenCalled();

    unmount();
    setDocumentPrerendering(false);
    document.dispatchEvent(new Event('prerenderingchange'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ensureGoogleAdManagerBoot).not.toHaveBeenCalled();
    expect(window.googletag.defineSlot).not.toHaveBeenCalled();
    expect(window.googletag.display).not.toHaveBeenCalled();
  });

  it('boots GPT after a prerendered route is activated', async () => {
    setDocumentPrerendering(true);

    render(
      <AdUnit
        placementKey="HEADER_LEADERBOARD"
        isActive
        loadStrategy="immediate"
      />
    );

    expect(ensureGoogleAdManagerBoot).not.toHaveBeenCalled();

    setDocumentPrerendering(false);
    await act(async () => {
      document.dispatchEvent(new Event('prerenderingchange'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ensureGoogleAdManagerBoot).toHaveBeenCalledOnce();
    expect(window.googletag.display).toHaveBeenCalledWith(
      'div-gpt-ad-header'
    );
  });

  it('recreates the GPT slot after a temporary Suspense hide', async () => {
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

    await waitFor(() => {
      expect(window.googletag.display).toHaveBeenCalledOnce();
    });

    rerender(
      <Suspense fallback={null}>
        <SuspensibleAd shouldSuspend />
      </Suspense>
    );

    await waitFor(() => {
      expect(window.googletag.destroySlots).toHaveBeenCalledOnce();
    });

    rerender(
      <Suspense fallback={null}>
        <SuspensibleAd shouldSuspend={false} />
      </Suspense>
    );

    await waitFor(() => {
      expect(window.googletag.display).toHaveBeenCalledTimes(2);
    });
  });
});
