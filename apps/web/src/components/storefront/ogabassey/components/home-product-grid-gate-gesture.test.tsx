import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../types';
import { HomeProductGridGate } from './home-product-grid-gate';
import { HomeProductGridStaticFallback } from './home-product-grid-static-fallback';

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

function renderGateWithLink(loadGridModule: () => Promise<never>) {
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
}

describe('HomeProductGridGate tap gestures', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('holds the fallback through a fast-load tap so the click lands on the pressed link', async () => {
    // The swallowed-tap race: pointerdown activates and the cached-fast
    // chunk resolves before release. Without the hold, the swap unmounts
    // the pressed anchor and the completing click never fires it.
    const loader = vi.fn(() =>
      Promise.resolve({
        HomeProductGrid: () => <div data-testid="interactive-grid" />,
      })
    );
    renderGateWithLink(loader as never);

    const fallbackLink = screen.getByRole('link', {
      name: 'iPhone 17 Pro Max',
    });
    await act(async () => {
      fireEvent.pointerDown(fallbackLink);
      await Promise.resolve();
    });
    expect(loader).toHaveBeenCalledOnce();

    // Loaded, but the in-flight press holds the fallback mounted: the
    // pressed anchor is still the click target.
    expect(
      screen.queryByTestId('interactive-grid')
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'iPhone 17 Pro Max' })
    ).toBeInTheDocument();

    // Release alone must NOT swap: the click still has to dispatch, and
    // swapping here would unmount the pressed anchor before it lands.
    await act(async () => {
      fireEvent.pointerUp(window);
      await Promise.resolve();
    });
    expect(
      screen.queryByTestId('interactive-grid')
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'iPhone 17 Pro Max' })
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(fallbackLink);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('interactive-grid')).toBeInTheDocument();
  });

  it('replays a pre-resolution load-more tap into the mounted grid', async () => {
    // The fallback load-more control is handler-free: the tap only reaches
    // the gate's activation listener. Without capture, the mounted grid
    // would still show eight products and the shopper would have to tap
    // again. The gate records the tap and replays it via prop on swap.
    const products = Array.from({ length: 10 }, (_, index) => ({
      ...stubProduct,
      id: `product-${index + 1}`,
      name: `Phone ${index + 1}`,
      slug: `phone-${index + 1}`,
    }));
    const loader = vi.fn(() =>
      Promise.resolve({
        HomeProductGrid: ({
          replayLoadMore,
        }: {
          replayLoadMore?: boolean;
        }) => (
          <div
            data-testid="interactive-grid"
            data-replay-load-more={String(Boolean(replayLoadMore))}
          />
        ),
        // The stub only models the replay prop; the full grid contract is
        // pinned by HomeProductGrid.test.tsx.
      } as never)
    );
    render(
      <HomeProductGridGate
        fallback={
          <HomeProductGridStaticFallback
            basePath=""
            products={products}
            initialDisplayCount={8}
          />
        }
        loadGridModule={loader}
        products={products}
        timeoutMs={10000}
      />
    );

    const moreButton = document.querySelector(
      '[data-ogabassey-home-products-more="true"]'
    );
    expect(moreButton).not.toBeNull();
    await act(async () => {
      fireEvent.pointerDown(moreButton!);
      await Promise.resolve();
    });
    // Loaded but held: the fallback (and its control) stays mounted.
    expect(
      screen.queryByTestId('interactive-grid')
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.pointerUp(window);
      await Promise.resolve();
    });
    expect(
      screen.queryByTestId('interactive-grid')
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(moreButton!);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('interactive-grid')).toHaveAttribute(
      'data-replay-load-more',
      'true'
    );
  });

  it('ignores taps on the load-more status text', async () => {
    // The replay marker lives on the button: a tap on the "Showing N of
    // M" label activates the grid without expanding it.
    const products = Array.from({ length: 10 }, (_, index) => ({
      ...stubProduct,
      id: `product-${index + 1}`,
      name: `Phone ${index + 1}`,
      slug: `phone-${index + 1}`,
    }));
    const loader = vi.fn(() =>
      Promise.resolve({
        HomeProductGrid: ({
          replayLoadMore,
        }: {
          replayLoadMore?: boolean;
        }) => (
          <div
            data-testid="interactive-grid"
            data-replay-load-more={String(Boolean(replayLoadMore))}
          />
        ),
      } as never)
    );
    render(
      <HomeProductGridGate
        fallback={
          <HomeProductGridStaticFallback
            basePath=""
            products={products}
            initialDisplayCount={8}
          />
        }
        loadGridModule={loader}
        products={products}
        timeoutMs={10000}
      />
    );

    const statusText = screen.getByText('Showing 8 of 10 products');
    await act(async () => {
      fireEvent.pointerDown(statusText);
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(statusText);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('interactive-grid')).toHaveAttribute(
      'data-replay-load-more',
      'false'
    );
  });

  it('swaps on a cancelled press without holding the fallback', async () => {
    const loader = vi.fn(() =>
      Promise.resolve({
        HomeProductGrid: () => <div data-testid="interactive-grid" />,
      })
    );
    renderGateWithLink(loader as never);

    const fallbackLink = screen.getByRole('link', {
      name: 'iPhone 17 Pro Max',
    });
    await act(async () => {
      fireEvent.pointerDown(fallbackLink);
      await Promise.resolve();
    });
    expect(
      screen.queryByTestId('interactive-grid')
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.pointerCancel(window);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('interactive-grid')).toBeInTheDocument();
  });
});
