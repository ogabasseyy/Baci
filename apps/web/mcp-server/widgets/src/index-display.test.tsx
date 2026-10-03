import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './index';

const products = [
  { id: 'phone-1', name: 'Phone One', slug: 'phone-one', price: 100000 },
];
afterEach(() => {
  delete window.openai;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.style.padding = '';
});
describe('Ogabassey inline result presentation', () => {
  it('reports compact content height after a resize and never opens fullscreen automatically', () => {
    let resized: (() => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      }
    );
    let contentHeight = 180;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ height: contentHeight }) as DOMRect
    );
    document.body.style.padding = '20px 16px 16px';
    const notifyIntrinsicHeight = vi.fn();
    const requestDisplayMode = vi.fn();
    window.openai = {
      toolOutput: { products: [products[0]] },
      notifyIntrinsicHeight,
      requestDisplayMode,
      displayMode: 'inline',
    };
    const { unmount } = render(<App />);
    expect(notifyIntrinsicHeight).toHaveBeenLastCalledWith(216);
    contentHeight = 300;
    resized?.();
    expect(notifyIntrinsicHeight).toHaveBeenLastCalledWith(336);
    expect(requestDisplayMode).not.toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it('shows loading then a completed empty search without asking the shopper to search again', () => {
    window.openai = {
      toolOutput: null,
      displayMode: 'inline',
      requestDisplayMode: vi.fn(),
    };
    render(<App />);
    expect(screen.getByRole('status').textContent).toBe(
      'Loading product results…'
    );
    act(() => {
      if (window.openai)
        window.openai.toolOutput = { status: 'empty', products: [] };
      window.dispatchEvent(
        new CustomEvent('openai:set_globals', {
          detail: { globals: { toolOutput: window.openai?.toolOutput } },
        })
      );
    });
    expect(
      screen.getByText('No verified products match this search.')
    ).toBeTruthy();
    expect(screen.queryByText('Ask me to search for products!')).toBeNull();
    expect(window.openai.requestDisplayMode).not.toHaveBeenCalled();
  });

  it('preserves the search error message in the widget', () => {
    window.openai = {
      toolOutput: {
        status: 'error',
        products: [],
        message: 'Search service temporarily unavailable.',
      },
    };
    render(<App />);
    expect(screen.getByRole('alert').textContent).toBe(
      'Search service temporarily unavailable.'
    );
  });
});
