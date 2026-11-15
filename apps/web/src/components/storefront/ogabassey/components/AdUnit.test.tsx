import { act, render, screen, waitFor } from '@testing-library/react';
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

describe('AdUnit', () => {
  let intersectionCallback:
    | IntersectionObserverCallback
    | undefined;
  let intersectionOptions: IntersectionObserverInit | undefined;
  let pubAdsService: {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    enableSingleRequest: ReturnType<typeof vi.fn>;
    collapseEmptyDivs: ReturnType<typeof vi.fn>;
    setTargeting: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    ensureGoogleAdManagerBoot.mockClear();
    ensureGoogleTag.mockClear();

    class MockIntersectionObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();

      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit
      ) {
        intersectionCallback = callback;
        intersectionOptions = options;
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
      refresh: vi.fn(),
      enableSingleRequest: vi.fn(),
      collapseEmptyDivs: vi.fn(),
      setTargeting: vi.fn(),
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
      enableServices: vi.fn(),
    } as unknown as typeof window.googletag;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    Reflect.deleteProperty(document, 'prerendering');
  });

  it('waits for the slot to approach the viewport before bootstrapping GPT', async () => {
    const { container } = render(<AdUnit placementKey="HOMEPAGE_STRIP" />);

    expect(screen.getByText('Sponsored')).toHaveClass(
      'ogabassey-ad-placeholder-text'
    );
    expect(screen.getByText('Advertisement')).toHaveClass(
      'ogabassey-ad-placeholder-text'
    );
    expect(ensureGoogleAdManagerBoot).not.toHaveBeenCalled();
    expect(intersectionCallback).toBeTypeOf('function');
    expect(intersectionOptions?.rootMargin).toBe('400px 0px');

    await act(async () => {
      intersectionCallback?.(
        [
          {
            isIntersecting: true,
            intersectionRatio: 1,
            target:
              container.querySelector('#div-gpt-ad-home-strip') ??
              document.body,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
      await Promise.resolve();
    });

    expect(ensureGoogleAdManagerBoot).toHaveBeenCalledOnce();

    await waitFor(() => {
      expect(window.googletag.defineSlot).toHaveBeenCalled();
      expect(window.googletag.display).toHaveBeenCalledWith(
        'div-gpt-ad-home-strip'
      );
    });
  });

  it('keeps inactive carousel ads off the startup path', async () => {
    const { container, rerender } = render(
      <AdUnit placementKey="HEADER_LEADERBOARD" isActive={false} />
    );

    expect(ensureGoogleAdManagerBoot).not.toHaveBeenCalled();

    rerender(<AdUnit placementKey="HEADER_LEADERBOARD" isActive />);

    await act(async () => {
      intersectionCallback?.(
        [
          {
            isIntersecting: true,
            intersectionRatio: 1,
            target:
              container.querySelector('#div-gpt-ad-header') ?? document.body,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
      await Promise.resolve();
    });

    expect(ensureGoogleAdManagerBoot).toHaveBeenCalledOnce();
  });

  it('honors boot delay elapsed before viewport entry when loading GPT', async () => {
    vi.useFakeTimers();

    const { container } = render(
      <AdUnit placementKey="HOMEPAGE_STRIP" bootDelayMs={9000} />
    );

    await act(async () => {
      vi.advanceTimersByTime(9000);
      await Promise.resolve();
    });

    expect(ensureGoogleAdManagerBoot).not.toHaveBeenCalled();

    await act(async () => {
      intersectionCallback?.(
        [
          {
            isIntersecting: true,
            intersectionRatio: 1,
            target:
              container.querySelector('#div-gpt-ad-home-strip') ??
              document.body,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ensureGoogleAdManagerBoot).toHaveBeenCalledOnce();
  });

  it('remembers elapsed boot delay while a carousel ad is inactive', async () => {
    vi.useFakeTimers();

    const { container, rerender } = render(
      <AdUnit
        placementKey="HEADER_LEADERBOARD"
        bootDelayMs={9000}
        isActive={false}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(9000);
      await Promise.resolve();
    });

    rerender(
      <AdUnit
        placementKey="HEADER_LEADERBOARD"
        bootDelayMs={9000}
        isActive
      />
    );

    await act(async () => {
      intersectionCallback?.(
        [
          {
            isIntersecting: true,
            intersectionRatio: 1,
            target:
              container.querySelector('#div-gpt-ad-header') ?? document.body,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ensureGoogleAdManagerBoot).toHaveBeenCalledOnce();
  });

  it('skips the pending boot when the slot becomes inactive before bootDelayMs completes', async () => {
    vi.useFakeTimers();

    const { container, rerender } = render(
      <AdUnit
        placementKey="HEADER_LEADERBOARD"
        bootDelayMs={9000}
        isActive
      />
    );

    await act(async () => {
      intersectionCallback?.(
        [
          {
            isIntersecting: true,
            intersectionRatio: 1,
            target:
              container.querySelector('#div-gpt-ad-header') ?? document.body,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(8999);
      await Promise.resolve();
    });

    rerender(
      <AdUnit
        placementKey="HEADER_LEADERBOARD"
        bootDelayMs={9000}
        isActive={false}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(1);
      // Flush the bootDelayMs completion and AdUnit effects after isActive flips
      // false so ensureGoogleAdManagerBoot stays off the inactive startup path.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ensureGoogleAdManagerBoot).not.toHaveBeenCalled();
  });


  it('bugfix: gives each repeat of a placement its own slot so every one requests an ad', async () => {
    // Two grid ads on one page used to share an element id, so the second
    // was skipped as "already defined" and never requested an ad.
    const { container } = render(
      <>
        <AdUnit
          loadStrategy="immediate"
          placementKey="PRODUCT_GRID_MPU"
          slotInstance={4}
        />
        <AdUnit
          loadStrategy="immediate"
          placementKey="PRODUCT_GRID_MPU"
          slotInstance={8}
        />
      </>
    );

    expect(container.querySelector('#div-gpt-ad-grid-mpu-4')).not.toBeNull();
    expect(container.querySelector('#div-gpt-ad-grid-mpu-8')).not.toBeNull();

    await waitFor(() => {
      expect(window.googletag.display).toHaveBeenCalledWith(
        'div-gpt-ad-grid-mpu-4'
      );
      expect(window.googletag.display).toHaveBeenCalledWith(
        'div-gpt-ad-grid-mpu-8'
      );
    });
    // Both use the same Ad Manager unit; only the page element differs.
    expect(window.googletag.defineSlot).toHaveBeenCalledWith(
      '/23331099951/in_feed_mpu',
      [300, 250],
      'div-gpt-ad-grid-mpu-4'
    );
    expect(window.googletag.defineSlot).toHaveBeenCalledWith(
      '/23331099951/in_feed_mpu',
      [300, 250],
      'div-gpt-ad-grid-mpu-8'
    );
  });

  it('keeps the plain placement id when no instance is given', () => {
    const { container } = render(<AdUnit placementKey="HOMEPAGE_STRIP" />);

    expect(container.querySelector('#div-gpt-ad-home-strip')).not.toBeNull();
  });
});
