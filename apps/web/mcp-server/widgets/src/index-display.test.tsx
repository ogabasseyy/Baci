import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './index';

const products = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Phone One', slug: 'phone-one', price: 100000 },
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

  it('updates inline height when results arrive without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    let contentHeight = 120;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ height: contentHeight }) as DOMRect
    );
    const notifyIntrinsicHeight = vi.fn();
    window.openai = {
      toolOutput: null,
      displayMode: 'inline',
      notifyIntrinsicHeight,
    };
    render(<App />);
    expect(notifyIntrinsicHeight).toHaveBeenLastCalledWith(120);
    contentHeight = 280;
    act(() => {
      if (window.openai) window.openai.toolOutput = { products };
      window.dispatchEvent(
        new CustomEvent('openai:set_globals', {
          detail: { globals: { toolOutput: window.openai?.toolOutput } },
        })
      );
    });
    expect(notifyIntrinsicHeight).toHaveBeenLastCalledWith(280);
  });

  it('qualifies an empty search with partial coverage', () => {
    window.openai = {
      toolOutput: { products: [], status: 'empty', coverage: 'partial' },
    };
    render(<App />);
    expect(screen.getByRole('status').textContent).toBe(
      'No verified match was found among the checked products. Other products may match.'
    );
    expect(screen.queryByText('No verified products match this search.')).toBeNull();
  });

  it('qualifies partial coverage alongside successful product cards', () => {
    window.openai = {
      toolOutput: { products, status: 'success', coverage: 'partial' },
    };
    render(<App />);
    expect(screen.getByText('Phone One')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(
      'Results cover only the products checked. Other products may match.'
    );
  });

  it('does not qualify complete product results as partially checked', () => {
    window.openai = {
      toolOutput: { products, status: 'success', coverage: 'complete' },
    };
    render(<App />);
    expect(screen.getByText('Phone One')).toBeTruthy();
    expect(screen.queryByText(
      'Results cover only the products checked. Other products may match.'
    )).toBeNull();
  });

  it('keeps a successful non-search tool output neutral', () => {
    window.openai = { toolOutput: { order: { status: 'processing' } } };
    render(<App />);
    expect(screen.getByRole('status').textContent).toBe('View the tool response in the conversation.');
    expect(screen.queryByText('No verified products match this search.')).toBeNull();
  });

  it('reports height for local cart additions, removals, errors and error clearing without ResizeObserver', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const height = 180 + (this.querySelector('.cart-summary') ? 100 : 0) + (this.querySelector('[role="alert"]') ? 40 : 0);
      return { height } as DOMRect;
    });
    const notifyIntrinsicHeight = vi.fn();
    const callTool = vi.fn().mockResolvedValue({ structuredContent: {
      success: true, cart_token: 'a'.repeat(64), cart_url: `https://ogabassey.com/cart?guest_cart=${encodeURIComponent(JSON.stringify([{ product_id: products[0].id, quantity: 1 }]))}`,
    } });
    window.openai = { toolOutput: { products }, displayMode: 'inline', notifyIntrinsicHeight, callTool, openExternal: vi.fn() };
    render(<App />);
    expect(notifyIntrinsicHeight).toHaveBeenLastCalledWith(180);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add to cart' })); });
    expect(screen.getByRole('button', { name: 'Remove Phone One' })).toBeTruthy();
    expect(notifyIntrinsicHeight).toHaveBeenLastCalledWith(280);
    callTool.mockResolvedValueOnce({ structuredContent: { success: true, cart_token: 'a'.repeat(64), cart_url: 'https://ogabassey.com/cart?guest_cart=[]' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove Phone One' })); });
    expect(notifyIntrinsicHeight).toHaveBeenLastCalledWith(180);
    callTool.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add to cart' })); });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(notifyIntrinsicHeight).toHaveBeenLastCalledWith(220);
    let finish: ((value: unknown) => void) | undefined;
    callTool.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Add to cart' })); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(notifyIntrinsicHeight).toHaveBeenLastCalledWith(180);
    await act(async () => { finish?.({ structuredContent: { success: true, cart_token: 'a'.repeat(64), cart_url: `https://ogabassey.com/cart?guest_cart=${encodeURIComponent(JSON.stringify([{ product_id: products[0].id, quantity: 1 }]))}` } }); });
    expect(notifyIntrinsicHeight).toHaveBeenLastCalledWith(280);
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
