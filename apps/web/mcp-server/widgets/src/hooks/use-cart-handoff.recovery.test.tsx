import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCartHandoff } from './use-cart-handoff';
const product = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Phone',
  slug: 'phone',
  price: 90000,
};
const second = {
  ...product,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Camera',
};
const token = 'a'.repeat(64);
function response(products = [product], cartToken = token) {
  const url = new URL('https://ogabassey.com/cart');
  const items = products.map((item) => ({ product_id: item.id, quantity: 1 }));
  url.searchParams.set('guest_cart', JSON.stringify(items));
  return {
    structuredContent: {
      success: true,
      cart_url: url.toString(),
      cart_token: cartToken,
      items,
      expires_at: '2026-10-14T00:00:00.000Z',
    },
  };
}
function expiredResponse() {
  return { structuredContent: { success: false, cart_expired: true } };
}
beforeEach(() => {
  vi.stubGlobal('open', vi.fn(() => null));
});
afterEach(() => {
  delete window.openai;
  vi.unstubAllGlobals();
});

it('replays local survivors when adding after an expired-cart removal', async () => {
  const fresh = 'b'.repeat(64);
  const third = {
    ...product,
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Watch',
  };
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response([product, second]))
    .mockResolvedValueOnce(expiredResponse())
    .mockResolvedValueOnce(response([third], fresh))
    .mockResolvedValueOnce(response([third, second], fresh));
  window.openai = { callTool, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  await act(async () => {
    await result.current.handleAddToCart(second);
  });
  await act(async () => {
    await result.current.handleRemoveItem(product.id);
  });
  expect(result.current.cart).toEqual([{ product: second, quantity: 1 }]);
  await act(async () => {
    await result.current.handleAddToCart(third);
  });
  expect(callTool).toHaveBeenCalledTimes(5);
  expect(callTool).toHaveBeenNthCalledWith(4, 'update_ogabassey_guest_cart', {
    product_id: third.id,
    quantity: 1,
    cart_token: undefined,
  });
  expect(callTool).toHaveBeenNthCalledWith(5, 'update_ogabassey_guest_cart', {
    product_id: second.id,
    quantity: 1,
    cart_token: fresh,
  });
  expect(result.current.cartError).toBeNull();
  expect(result.current.cart).toEqual([
    { product: second, quantity: 1 },
    { product: third, quantity: 1 },
  ]);
});
it('retries a stale token once and replays survivors into the fresh cart', async () => {
  const fresh = 'b'.repeat(64);
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response([product, second]))
    .mockResolvedValueOnce(expiredResponse())
    .mockResolvedValueOnce(response([product], fresh))
    .mockResolvedValueOnce(response([product, second], fresh));
  window.openai = { callTool, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  await act(async () => {
    await result.current.handleAddToCart(second);
  });
  expect(result.current.cart).toHaveLength(2);
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  expect(callTool).toHaveBeenCalledTimes(5);
  expect(callTool).toHaveBeenNthCalledWith(3, 'update_ogabassey_guest_cart', {
    product_id: product.id,
    quantity: 2,
    cart_token: token,
  });
  expect(callTool).toHaveBeenNthCalledWith(4, 'update_ogabassey_guest_cart', {
    product_id: product.id,
    quantity: 2,
    cart_token: undefined,
  });
  expect(callTool).toHaveBeenNthCalledWith(5, 'update_ogabassey_guest_cart', {
    product_id: second.id,
    quantity: 1,
    cart_token: fresh,
  });
  expect(result.current.cartError).toBeNull();
  expect(result.current.cart).toEqual([
    { product: second, quantity: 1 },
    { product, quantity: 1 },
  ]);
});
it('drops only the variant-selection survivor when its replay cannot restore it', async () => {
  const fresh = 'b'.repeat(64);
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response([product, second]))
    .mockResolvedValueOnce(expiredResponse())
    .mockResolvedValueOnce(response([product], fresh))
    .mockResolvedValueOnce({
      structuredContent: {
        success: false,
        requires_variant_selection: true,
        product_id: second.id,
        product_url: 'https://ogabassey.com/products/camera',
      },
    });
  window.openai = { callTool, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  await act(async () => {
    await result.current.handleAddToCart(second);
  });
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  expect(callTool).toHaveBeenCalledTimes(5);
  expect(result.current.cartError).toBeNull();
  expect(result.current.cart).toEqual([{ product, quantity: 1 }]);
});
it('surfaces an error when the recovery retry also reports an expired cart', async () => {
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(expiredResponse())
    .mockResolvedValueOnce(expiredResponse());
  window.openai = { callTool, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  await act(async () => {
    await result.current.handleAddToCart(second);
  });
  expect(callTool).toHaveBeenCalledTimes(3);
  expect(result.current.cart).toHaveLength(1);
  expect(result.current.cartError).toBe(
    'This item cannot be added right now. Please choose another product.'
  );
});
it('keeps local lines and surfaces an error when a replay transport fails', async () => {
  const freshToken = 'b'.repeat(64);
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(expiredResponse())
    .mockResolvedValueOnce(response([second], freshToken))
    .mockRejectedValueOnce(new Error('offline'));
  window.openai = { callTool, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  await act(async () => {
    await result.current.handleAddToCart(second);
  });
  // Add, expired add, retry mint, failed replay, then the clicked line
  // emptied so the partial fresh cart retires instead of orphaning.
  expect(callTool).toHaveBeenCalledTimes(5);
  expect(callTool).toHaveBeenLastCalledWith('update_ogabassey_guest_cart', {
    product_id: second.id,
    quantity: 0,
    cart_token: freshToken,
  });
  expect(result.current.cart).toHaveLength(1);
  expect(result.current.cart[0].product.id).toBe(product.id);
  expect(result.current.cartError).toBe(
    'Could not save the guest cart. Please try again.'
  );
});
it('recovers a removal against an expired cart locally and forgets the dead token', async () => {
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response([product, second]))
    .mockResolvedValueOnce(expiredResponse())
    .mockResolvedValueOnce(response([second]));
  const openExternal = vi.fn();
  window.openai = { callTool, openExternal, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  await act(async () => {
    await result.current.handleAddToCart(second);
  });
  await act(async () => {
    await result.current.handleRemoveItem(product.id);
  });
  expect(callTool).toHaveBeenCalledTimes(3);
  expect(result.current.cartError).toBeNull();
  expect(result.current.cart).toEqual([{ product: second, quantity: 1 }]);
  act(() => result.current.handleViewCart());
  const href = openExternal.mock.calls[0][0].href as string;
  expect(JSON.parse(new URL(href).searchParams.get('guest_cart') ?? '[]')).toEqual([
    { product_id: second.id, quantity: 1 },
  ]);
  await act(async () => {
    await result.current.handleAddToCart(second);
  });
  expect(callTool).toHaveBeenLastCalledWith('update_ogabassey_guest_cart', {
    product_id: second.id,
    quantity: 2,
    cart_token: undefined,
  });
});
it('opens the bare cart for legacy one-shot handoffs instead of replaying them', async () => {
  const openExternal = vi.fn();
  window.openai = {
    widgetState: {
      cart: [{ product, quantity: 1 }],
      cartUrl: `https://ogabassey.com/cart?item_id=${product.id}&qty=1`,
    },
    openExternal,
    callTool: vi.fn(),
    setWidgetState: vi.fn(),
  };
  const { result } = renderHook(() => useCartHandoff());
  expect(result.current.cart).toHaveLength(1);
  act(() => result.current.handleViewCart());
  expect(openExternal).toHaveBeenCalledWith({
    href: 'https://ogabassey.com/cart',
  });
});

it('opens the bare cart when the stored handoff payload is malformed', async () => {
  const openExternal = vi.fn();
  window.openai = {
    widgetState: {
      cart: [{ product, quantity: 1 }],
      cartUrl: 'https://ogabassey.com/cart?guest_cart=not-json',
    },
    openExternal,
    callTool: vi.fn(),
    setWidgetState: vi.fn(),
  };
  const { result } = renderHook(() => useCartHandoff());
  expect(result.current.cart).toHaveLength(1);
  act(() => result.current.handleViewCart());
  expect(openExternal).toHaveBeenCalledWith({
    href: 'https://ogabassey.com/cart',
  });
});

it('removes locally when legacy state has no token', async () => {
  const callTool = vi.fn();
  window.openai = {
    widgetState: {
      cart: [
        { product, quantity: 1 },
        { product: second, quantity: 1 },
      ],
      cartUrl: `https://ogabassey.com/cart?item_id=${product.id}&qty=1`,
    },
    callTool,
    setWidgetState: vi.fn(),
  };
  const { result } = renderHook(() => useCartHandoff());
  expect(result.current.cart).toHaveLength(2);
  await act(async () => {
    await result.current.handleRemoveItem(product.id);
  });
  expect(callTool).not.toHaveBeenCalled();
  expect(result.current.cartError).toBeNull();
  expect(result.current.cart).toEqual([{ product: second, quantity: 1 }]);
});
