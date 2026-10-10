import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCartReview } from './use-cart-review';
import type { CartItem } from '../widget-types';

const product = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Phone',
  slug: 'phone',
  price: 90000,
};
const cart: CartItem[] = [{ product, quantity: 1 }];
const foreignGuestCart = encodeURIComponent(
  JSON.stringify([
    { product_id: '22222222-2222-4222-8222-222222222222', quantity: 1 },
  ])
);
const foreignUrl = `https://ogabassey.com/cart?guest_cart=${foreignGuestCart}`;

function setup(options: {
  cart?: CartItem[];
  cartUrl?: string;
  busy?: boolean;
}) {
  const openExternal = vi.fn();
  window.openai = { openExternal };
  const setCartError = vi.fn();
  const hook = renderHook(() =>
    useCartReview({
      cart: options.cart ?? [],
      cartUrl: options.cartUrl,
      busy: { current: options.busy ?? false },
      setCartError,
    })
  );
  return { ...hook, openExternal, setCartError };
}

beforeEach(() => {
  delete window.openai;
});

it('reviews a local cart through the validated handoff URL', () => {
  const { result, openExternal, setCartError } = setup({
    cart,
    cartUrl: 'https://ogabassey.com/cart?guest_cart=%5B%5D',
  });
  expect(result.current.canReviewCart).toBe(true);
  act(() => {
    result.current.handleViewCart();
  });
  expect(openExternal).toHaveBeenCalledWith({
    href: 'https://ogabassey.com/cart',
  });
  expect(setCartError).not.toHaveBeenCalled();
});

it('reviews a foreign-only cart from its handoff lines', () => {
  const { result, openExternal } = setup({ cartUrl: foreignUrl });
  expect(result.current.canReviewCart).toBe(true);
  act(() => {
    result.current.handleViewCart();
  });
  expect(openExternal).toHaveBeenCalledWith({ href: foreignUrl });
});

it('refuses navigation without reviewable lines', () => {
  for (const cartUrl of [
    undefined,
    'https://ogabassey.com/cart',
    'https://ogabassey.com/cart?guest_cart=[]',
    'notaurl',
    'https://evil.example/cart',
  ]) {
    const { result, openExternal, setCartError } = setup({ cartUrl });
    expect(result.current.canReviewCart).toBe(false);
    act(() => {
      result.current.handleViewCart();
    });
    expect(openExternal).not.toHaveBeenCalled();
    expect(setCartError).not.toHaveBeenCalled();
  }
});

it('reports a rejected review URL instead of silently doing nothing', () => {
  for (const cartUrl of [
    'https://evil.example/cart',
    'https://ogabassey.com/checkout',
  ]) {
    const { result, openExternal, setCartError } = setup({ cart, cartUrl });
    expect(result.current.canReviewCart).toBe(true);
    act(() => {
      result.current.handleViewCart();
    });
    expect(openExternal).not.toHaveBeenCalled();
    expect(setCartError).toHaveBeenCalledWith(
      'This guest cart link is no longer valid.'
    );
  }
});

it('holds navigation while a handoff is in flight', () => {
  const { result, openExternal } = setup({
    cart,
    cartUrl: foreignUrl,
    busy: true,
  });
  expect(result.current.canReviewCart).toBe(true);
  act(() => {
    result.current.handleViewCart();
  });
  expect(openExternal).not.toHaveBeenCalled();
});

it('reports a navigation failure instead of throwing', () => {
  const { result, setCartError } = setup({ cart, cartUrl: foreignUrl });
  window.openai = {
    openExternal: vi.fn(() => {
      throw new Error('bridge down');
    }),
  };
  act(() => {
    result.current.handleViewCart();
  });
  expect(setCartError).toHaveBeenCalledWith(
    'Could not open your guest cart. Please try again.'
  );
});
