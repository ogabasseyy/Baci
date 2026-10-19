import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './index';

const products = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Phone One', slug: 'phone-one', price: 100000 },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Phone Two', slug: 'phone-two', price: 120000 },
];

afterEach(() => {
  delete window.openai;
});

describe('Ogabassey guest cart widget', () => {
  it('serializes cart saves so a late response cannot fork the guest cart', async () => {
    let finish: ((value: unknown) => void) | undefined;
    const callTool = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const openExternal = vi.fn();
    window.openai = { toolOutput: { products }, callTool, openExternal };
    render(<App />);
    const buttons = screen.getAllByRole('button', { name: 'Add to cart' });
    fireEvent.click(buttons[0]); fireEvent.click(buttons[1]);
    expect(callTool).toHaveBeenCalledTimes(1);
    const url = new URL('https://ogabassey.com/cart');
    url.searchParams.set('guest_cart', JSON.stringify([{ product_id: products[0].id, quantity: 1 }]));
    await act(async () => { finish?.({ structuredContent: { success: true, cart_url: url.toString(), cart_token: 'a'.repeat(64), items: [{ product_id: products[0].id, quantity: 1 }], expires_at: '2026-10-14T00:00:00.000Z' } }); });
    expect(screen.getByText('Phone One', { selector: '.cart-item-name' })).toBeTruthy();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('lets a shopper replace a legacy selection with no handoff URL', () => {
    window.openai = {
      toolOutput: { products },
      widgetState: { cart: [{ product: products[0], quantity: 1 }] },
    };
    render(<App />);

    expect(screen.getAllByRole('button', { name: 'Add to cart' })).toHaveLength(2);
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

  it('opens the exact product page when a variant must be selected', async () => {
    const openExternal = vi.fn();
    window.openai = {
      toolOutput: { products },
      openExternal,
      callTool: vi.fn().mockResolvedValue({
        structuredContent: {
          success: false,
          requires_variant_selection: true,
          product_id: '11111111-1111-4111-8111-111111111111',
          product_url: 'https://ogabassey.com/products/phone-one',
        },
      }),
    };
    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Add to cart' })[0]);
    });

    expect(openExternal).toHaveBeenCalledWith({ href: 'https://ogabassey.com/products/phone-one' });
    expect(screen.queryByRole('button', { name: 'Review Cart on Ogabassey →' })).toBeNull();
  });

  it('preserves an existing guest cart while a variant needs selection', async () => {
    const openExternal = vi.fn();
    window.openai = {
      toolOutput: { products },
      widgetState: {
        cart: [{ product: products[1], quantity: 1 }],
        cartUrl: 'https://ogabassey.com/cart?item_id=phone-2',
      },
      openExternal,
      callTool: vi.fn().mockResolvedValue({
        structuredContent: {
          success: false,
          requires_variant_selection: true,
          product_id: '11111111-1111-4111-8111-111111111111',
          product_url: 'https://ogabassey.com/products/phone-one',
        },
      }),
    };
    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    });

    expect(openExternal).toHaveBeenCalledWith({ href: 'https://ogabassey.com/products/phone-one' });
    expect(screen.getByText('Phone Two', { selector: '.cart-item-name' })).toBeTruthy();
  });

  it('surfaces cart lines added outside the widget instead of hiding them', async () => {
    const url = new URL('https://ogabassey.com/cart');
    url.searchParams.set(
      'guest_cart',
      JSON.stringify([
        { product_id: products[0].id, quantity: 1 },
        { product_id: products[1].id, quantity: 1 },
      ])
    );
    window.openai = {
      toolOutput: { products },
      setWidgetState: vi.fn(),
      callTool: vi.fn().mockResolvedValue({
        structuredContent: {
          success: true,
          cart_url: url.toString(),
          cart_token: 'a'.repeat(64),
          items: [
            { product_id: products[0].id, quantity: 1 },
            { product_id: products[1].id, quantity: 1 },
          ],
          expires_at: '2026-10-14T00:00:00.000Z',
        },
      }),
    };
    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Add to cart' })[0]);
    });

    expect(screen.getByText(/another chat/)).toBeTruthy();
    expect(screen.getByText('Phone One', { selector: '.cart-item-name' })).toBeTruthy();
    expect(screen.queryByText('Phone Two', { selector: '.cart-item-name' })).toBeNull();
  });

  it('names a survivor the recovery had to drop instead of hiding it', async () => {
    const fresh = 'b'.repeat(64);
    const mintUrl = new URL('https://ogabassey.com/cart');
    mintUrl.searchParams.set(
      'guest_cart',
      JSON.stringify([{ product_id: products[0].id, quantity: 1 }])
    );
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({
        structuredContent: { success: false, cart_expired: true },
      })
      .mockResolvedValueOnce({
        structuredContent: {
          success: true,
          cart_url: mintUrl.toString(),
          cart_token: fresh,
        },
      })
      .mockResolvedValueOnce({
        structuredContent: {
          success: false,
          product_unavailable: true,
          product_id: products[1].id,
        },
      });
    window.openai = {
      toolOutput: { products },
      widgetState: {
        cart: [{ product: products[1], quantity: 1 }],
        cartUrl: 'https://ogabassey.com/cart?item_id=phone-2',
        cartToken: 'a'.repeat(64),
      },
      setWidgetState: vi.fn(),
      callTool,
      openExternal: vi.fn(),
    };
    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Add to cart' })[0]);
    });

    expect(callTool).toHaveBeenCalledTimes(3);
    expect(
      screen.getByText(
        'Phone Two is no longer available and was removed from your guest cart.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('Phone One', { selector: '.cart-item-name' })
    ).toBeTruthy();
    expect(
      screen.queryByText('Phone Two', { selector: '.cart-item-name' })
    ).toBeNull();
  });

  it('keeps Review reachable when only foreign lines remain', () => {
    const guestCart = encodeURIComponent(
      JSON.stringify([
        { product_id: '33333333-3333-4333-8333-333333333333', quantity: 1 },
      ])
    );
    const openExternal = vi.fn();
    window.openai = {
      toolOutput: { products },
      widgetState: {
        cart: [],
        cartUrl: `https://ogabassey.com/cart?guest_cart=${guestCart}`,
        cartToken: 'a'.repeat(64),
      },
      setWidgetState: vi.fn(),
      openExternal,
    };
    const { container } = render(<App />);

    // Both the summary and the sticky footer offer Review; no local
    // lines render, and the empty-cart badge stays hidden.
    const reviews = screen.getAllByRole('button', {
      name: /Review Cart on Ogabassey/,
    });
    expect(reviews).toHaveLength(2);
    expect(
      screen.queryByText('Phone One', { selector: '.cart-item-name' })
    ).toBeNull();
    expect(container.querySelector('.cart-badge')).toBeNull();
    fireEvent.click(reviews[0]);
    expect(openExternal).toHaveBeenCalledWith({
      href: `https://ogabassey.com/cart?guest_cart=${guestCart}`,
    });
  });

  it('explains a removal when the tool bridge is unavailable', () => {
    window.openai = {
      toolOutput: { products },
      widgetState: {
        cart: [{ product: products[0], quantity: 1 }],
        cartUrl: 'https://ogabassey.com/cart?item_id=phone-1',
        cartToken: 'a'.repeat(64),
      },
      // No callTool: a restored token-backed state the host cannot serve.
    };
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Phone One' }));

    expect(
      screen.getByText(
        'ChatGPT cannot open the cart here. Use Review on Ogabassey to continue.'
      )
    ).toBeTruthy();
    // Nothing was removed anywhere, so the line stays put.
    expect(
      screen.getByText('Phone One', { selector: '.cart-item-name' })
    ).toBeTruthy();
  });
});
