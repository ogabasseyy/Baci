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

describe('HomeProductGridGate', () => {
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
    // Flush the mocked post-LCP signal through effects so the gate arms
    // its observer and backstop — the test-side equivalent of LCP
    // settling in production.
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('renders the static fallback without loading the grid module', () => {
    const loadGridModule = vi.fn(() =>
      Promise.resolve({
        HomeProductGrid: () => <div data-testid="interactive-grid" />,
      })
    );

    render(
      <HomeProductGridGate
        fallback={<div>Static product snapshot</div>}
        loadGridModule={loadGridModule}
        products={[stubProduct]}
        timeoutMs={1000}
      />
    );

    expect(screen.getByText('Static product snapshot')).toBeInTheDocument();
    expect(loadGridModule).not.toHaveBeenCalled();
    expect(screen.queryByTestId('interactive-grid')).not.toBeInTheDocument();
  });

  it('loads the grid module once after the backstop timeout and swaps it in', async () => {
    const loadGridModule = vi.fn(() =>
      Promise.resolve({
        HomeProductGrid: ({ products }: { products?: Product[] }) => (
          <div data-testid="interactive-grid">
            Interactive ({products?.length ?? 0})
          </div>
        ),
      })
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

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(loadGridModule).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadGridModule).toHaveBeenCalledOnce();
    expect(screen.getByTestId('interactive-grid')).toHaveTextContent(
      'Interactive (1)'
    );
    expect(
      screen.queryByText('Static product snapshot')
    ).not.toBeInTheDocument();
  });

  it('loads the grid as soon as the section approaches the viewport', async () => {
    const loadGridModule = vi.fn(() =>
      Promise.resolve({
        HomeProductGrid: () => <div data-testid="interactive-grid" />,
      })
    );

    render(
      <HomeProductGridGate
        fallback={<div>Static product snapshot</div>}
        loadGridModule={loadGridModule}
        products={[stubProduct]}
        timeoutMs={10000}
      />
    );
    await settleLcpSignal();

    expect(loadGridModule).not.toHaveBeenCalled();

    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadGridModule).toHaveBeenCalledOnce();
    expect(screen.getByTestId('interactive-grid')).toBeInTheDocument();
  });

  it('holds the chunk while the LCP window is pending despite intersection', async () => {
    // The grid sits inside the expanded initial viewport on mobile: the
    // observer fires on hydration, but the import must wait for the
    // post-LCP signal (or interaction) instead of racing the hero.
    let resolveLcpWindow: () => void = () => undefined;
    mocks.waitForLcpWindowEnd.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        resolveLcpWindow = () => resolve(undefined);
      })
    );
    const loadGridModule = vi.fn(() =>
      Promise.resolve({
        HomeProductGrid: () => <div data-testid="interactive-grid" />,
      })
    );

    render(
      <HomeProductGridGate
        fallback={<div>Static product snapshot</div>}
        loadGridModule={loadGridModule}
        products={[stubProduct]}
        timeoutMs={10000}
      />
    );

    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
      await Promise.resolve();
    });
    expect(loadGridModule).not.toHaveBeenCalled();

    await act(async () => {
      resolveLcpWindow();
      await Promise.resolve();
    });
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadGridModule).toHaveBeenCalledOnce();
    expect(screen.getByTestId('interactive-grid')).toBeInTheDocument();
  });

  it('restores focus to the matching grid control when the swap unmounts the focused fallback link', async () => {
    const loadGridModule = vi.fn(() =>
      Promise.resolve({
        HomeProductGrid: () => (
          <div data-testid="interactive-grid">
            <a href="/products/iphone">iPhone 17 Pro Max</a>
          </div>
        ),
      })
    );

    render(
      <HomeProductGridGate
        fallback={
          <div>
            <a href="/products/iphone">iPhone 17 Pro Max</a>
          </div>
        }
        loadGridModule={loadGridModule}
        products={[stubProduct]}
        timeoutMs={10000}
      />
    );
    await settleLcpSignal();

    const fallbackLink = screen.getByRole('link', {
      name: 'iPhone 17 Pro Max',
    });
    fallbackLink.focus();
    expect(document.activeElement).toBe(fallbackLink);

    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('interactive-grid')).toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute(
      'href',
      '/products/iphone'
    );
    expect(document.activeElement).not.toBe(fallbackLink);
  });

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
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(flakyLoad).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('interactive-grid')).toBeInTheDocument();
  });
});
