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

describe('HomeProductGridGate focus restore', () => {
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

  it('restores focus to the grid control only after the held fallback swaps', async () => {
    // The grid chunk resolves mid-press while the fallback stays mounted:
    // restoring then would focus the fallback control and drop focus to
    // the document when the completing click swaps. Focus must move to
    // the interactive twin only.
    const loader = vi.fn(() =>
      Promise.resolve({
        HomeProductGrid: () => (
          <div>
            <button type="button">Load More Products</button>
          </div>
        ),
      })
    );
    render(
      <HomeProductGridGate
        fallback={
          <div>
            <button type="button">Load More Products</button>
          </div>
        }
        loadGridModule={loader as never}
        products={[stubProduct]}
        timeoutMs={10000}
      />
    );

    const fallbackButton = screen.getByRole('button', {
      name: 'Load More Products',
    });
    await act(async () => {
      // Focus first, then press synchronously: the press must land while
      // the LCP window is still pending (interaction branch), mirroring
      // the gesture suite — awaiting between them lets the mocked LCP
      // signal settle and move activation to the observer branch.
      fallbackButton.focus();
      fireEvent.pointerDown(fallbackButton);
      await Promise.resolve();
    });
    expect(loader).toHaveBeenCalledOnce();
    await act(async () => {
      await Promise.resolve();
    });
    // Loaded but held: no premature restore, focus stays put.
    expect(document.activeElement).toBe(fallbackButton);

    await act(async () => {
      fireEvent.click(fallbackButton);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Swap committed: focus restored to the grid twin, not the document.
    const gridButton = screen.getByRole('button', {
      name: 'Load More Products',
    });
    expect(gridButton).not.toBe(fallbackButton);
    expect(document.activeElement).toBe(gridButton);
  });
});
