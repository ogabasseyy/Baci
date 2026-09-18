import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../types';
import { HomeProductGridGate } from './home-product-grid-gate';

const mocks = vi.hoisted(() => ({
  // The gate defers to the post-LCP signal; resolve immediately so timing
  // stays deterministic under jsdom, which never emits LCP entries.
  waitForLcpWindowEnd: vi.fn(async () => undefined),
}));

vi.mock('@/lib/posthog/wait-for-lcp', () => ({
  waitForLcpWindowEnd: mocks.waitForLcpWindowEnd,
}));

const stubProduct: Product = {
  id: 'product-1',
  name: 'iPhone 17 Pro Max',
  price: '₦2,100,000',
  image: '/iphone.jpg',
  description: 'Flagship phone.',
};

describe('HomeProductGridGate loading failure recovery', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let observerCallback: IntersectionObserverCallback | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    observerCallback = null;
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function settleLcpSignal() {
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('keeps the fallback when the grid module fails to load', async () => {
    const loadGridModule = vi.fn(() =>
      Promise.reject(new Error('chunk failed'))
    );

    render(
      <HomeProductGridGate
        fallback={<div>Static product snapshot</div>}
        loadGridModule={loadGridModule}
        products={[stubProduct]}
        timeoutMs={1000}
      />
    );
    await settleLcpSignal();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadGridModule).toHaveBeenCalledOnce();
    expect(screen.getByText('Static product snapshot')).toBeInTheDocument();
  });

  it('retries the grid load on the next interaction after a failure', async () => {
    // An offline or stale-deployment blip must not wedge the fallback (and
    // its inert Load More row) permanently: the following interaction
    // retries the import and swaps in the grid when it succeeds.
    let shouldFail = true;
    const flakyLoad = vi.fn(() =>
      shouldFail
        ? Promise.reject(new Error('chunk failed'))
        : Promise.resolve({
            HomeProductGrid: () => <div data-testid="interactive-grid" />,
          })
    );

    render(
      <HomeProductGridGate
        fallback={<div>Static product snapshot</div>}
        loadGridModule={flakyLoad}
        products={[stubProduct]}
        timeoutMs={1000}
      />
    );
    await settleLcpSignal();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(flakyLoad).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('interactive-grid')).not.toBeInTheDocument();

    shouldFail = false;
    await act(async () => {
      fireEvent.pointerDown(window);
      fireEvent.pointerUp(window);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(flakyLoad).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('interactive-grid')).toBeInTheDocument();
  });
});
