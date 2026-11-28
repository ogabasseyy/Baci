import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeferredAdUnit } from './deferred-ad-unit';

describe('DeferredAdUnit', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('loads the AdUnit module only after deferred activation', async () => {
    const loadAdUnitModule = vi.fn(() =>
      Promise.resolve({
        AdUnit: ({ placementKey }: { placementKey: string }) => (
          <div data-testid="ad-unit">{placementKey}</div>
        ),
      })
    );

    render(
      <DeferredAdUnit
        fallback={<div>Reserved ad space</div>}
        loadAdUnitModule={loadAdUnitModule}
        placementKey="HOMEPAGE_STRIP"
        timeoutMs={1000}
      />
    );

    expect(screen.getByText('Reserved ad space')).toBeInTheDocument();
    expect(loadAdUnitModule).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(loadAdUnitModule).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadAdUnitModule).toHaveBeenCalledOnce();
    expect(screen.getByText('HOMEPAGE_STRIP')).toBeInTheDocument();
  });

  it('reserves a height-locked ad-slot fallback when none is provided', () => {
    const loadAdUnitModule = vi.fn(() =>
      Promise.resolve({ AdUnit: () => <div data-testid="ad-unit" /> })
    );

    const { container } = render(
      <DeferredAdUnit
        loadAdUnitModule={loadAdUnitModule}
        placementKey="PRODUCT_GRID_MPU"
        timeoutMs={1000}
      />
    );

    // Before activation the default shell reserves the slot at the exact
    // configured creative height (MPU mobile = 250px), so the later swap to the
    // real AdUnit does not shift layout.
    const box = container.querySelector('.ogabassey-ad-slot') as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.style.getPropertyValue('--ad-slot-h')).toBe('250px');
    expect(loadAdUnitModule).not.toHaveBeenCalled();
  });



  it('respects an explicit null fallback by rendering no reserved shell', () => {
    const loadAdUnitModule = vi.fn(() =>
      Promise.resolve({ AdUnit: () => <div data-testid="ad-unit" /> })
    );

    const { container } = render(
      <DeferredAdUnit
        fallback={null}
        loadAdUnitModule={loadAdUnitModule}
        placementKey="PRODUCT_GRID_MPU"
        timeoutMs={1000}
      />
    );

    expect(container.querySelector('.ogabassey-ad-slot')).toBeNull();
    expect(loadAdUnitModule).not.toHaveBeenCalled();
  });

  it('keeps the fallback visible and logs when the AdUnit import fails', async () => {
    const importError = new Error('ad chunk failed');
    const loadAdUnitModule = vi.fn(() => Promise.reject(importError));

    render(
      <DeferredAdUnit
        fallback={<div>Reserved ad space</div>}
        loadAdUnitModule={loadAdUnitModule}
        placementKey="HOMEPAGE_STRIP"
        timeoutMs={1000}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(loadAdUnitModule).toHaveBeenCalledOnce();
    expect(screen.getByText('Reserved ad space')).toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[DeferredAdUnit] Failed to load AdUnit module',
      importError
    );
  });

  it('does not import the AdUnit module after unmounting before activation', () => {
    const loadAdUnitModule = vi.fn(() =>
      Promise.resolve({
        AdUnit: ({ placementKey }: { placementKey: string }) => (
          <div>{placementKey}</div>
        ),
      })
    );

    const { unmount } = render(
      <DeferredAdUnit
        fallback={<div>Reserved ad space</div>}
        loadAdUnitModule={loadAdUnitModule}
        placementKey="HOMEPAGE_STRIP"
        timeoutMs={1000}
      />
    );

    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(loadAdUnitModule).not.toHaveBeenCalled();
  });

  it('activates on window scroll when activateOnScroll is enabled while staying idle without interaction', async () => {
    const loadAdUnitModule = vi.fn(() =>
      Promise.resolve({
        AdUnit: ({ placementKey }: { placementKey: string }) => (
          <div data-testid="ad-unit">{placementKey}</div>
        ),
      })
    );

    render(
      <DeferredAdUnit
        activateOnInteraction
        activateOnScroll
        fallback={<div>Reserved ad space</div>}
        loadAdUnitModule={loadAdUnitModule}
        placementKey="HOMEPAGE_STRIP"
        timeoutMs={0}
      />
    );

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(loadAdUnitModule).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadAdUnitModule).toHaveBeenCalledOnce();
    expect(screen.getByText('HOMEPAGE_STRIP')).toBeInTheDocument();
  });
});
