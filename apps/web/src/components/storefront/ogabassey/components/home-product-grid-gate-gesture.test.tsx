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
