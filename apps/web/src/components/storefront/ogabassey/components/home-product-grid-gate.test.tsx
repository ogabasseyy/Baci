import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../types';
import { HomeProductGridGate } from './home-product-grid-gate';

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
});
