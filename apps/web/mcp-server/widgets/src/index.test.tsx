import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './index';

const products = [
  { id: 'phone-1', name: 'Phone One', slug: 'phone-one', price: 100000 },
  { id: 'phone-2', name: 'Phone Two', slug: 'phone-two', price: 120000 },
];

afterEach(() => {
  delete window.openai;
});

describe('Ogabassey cart handoff widget', () => {
  it('shows the Ogabassey logo and offers fullscreen browsing for a catalog', () => {
    const requestDisplayMode = vi.fn().mockResolvedValue(undefined);
    const setOpenInAppUrl = vi.fn();
    window.openai = { toolOutput: { products }, requestDisplayMode, setOpenInAppUrl, displayMode: 'inline' };
    render(<App />);

    expect(screen.getByRole('img', { name: 'Ogabassey logo' })).toBeTruthy();
    expect(setOpenInAppUrl).toHaveBeenCalledWith({ href: 'https://ogabassey.com' });
    fireEvent.click(screen.getByRole('button', { name: 'Expand catalog' }));
    expect(requestDisplayMode).toHaveBeenCalledWith({ mode: 'fullscreen' });
  });

  it('keeps the latest item when an older handoff finishes late', async () => {
    const pending = new Map<string, (value: unknown) => void>();
    window.openai = {
      toolOutput: { products },
      callTool: (_name, args) => new Promise((resolve) => {
        pending.set(String(args.product_id), resolve);
      }),
    };
    render(<App />);

    const buttons = screen.getAllByRole('button', { name: 'Prepare Cart Link' });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    await act(async () => {
      pending.get('phone-2')?.({
        structuredContent: {
          success: true,
          cart_url: 'https://ogabassey.com/cart?item_id=phone-2',
        },
      });
    });
    await act(async () => {
      pending.get('phone-1')?.({
        structuredContent: {
          success: true,
          cart_url: 'https://ogabassey.com/cart?item_id=phone-1',
        },
      });
    });

    expect(screen.getByText('Phone Two', { selector: '.cart-item-name' })).toBeTruthy();
    expect(screen.queryByText('Phone One', { selector: '.cart-item-name' })).toBeNull();
  });

  it('lets a shopper replace a legacy selection with no handoff URL', () => {
    window.openai = {
      toolOutput: { products },
      widgetState: { cart: [{ product: products[0], quantity: 1 }] },
    };
    render(<App />);

    expect(screen.getAllByRole('button', { name: 'Prepare Cart Link' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Review Cart on Ogabassey →' })).toBeNull();
  });

  it('opens the listed product page for review without preparing a cart', () => {
    const openExternal = vi.fn();
    const callTool = vi.fn();
    window.openai = { toolOutput: { products }, openExternal, callTool };
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Review on Ogabassey' })[0]);

    expect(openExternal).toHaveBeenCalledWith({ href: 'https://ogabassey.com/products/phone-one' });
    expect(callTool).not.toHaveBeenCalled();
  });
});
