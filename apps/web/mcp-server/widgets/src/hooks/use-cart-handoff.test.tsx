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
it('saves without navigating and transfers the whole cart only on review', async () => {
  const openExternal = vi.fn();
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response([product, second]));
  window.openai = { openExternal, callTool, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  await act(async () => {
    await result.current.handleAddToCart(second);
  });
  expect(result.current.cart).toHaveLength(2);
  expect(callTool).toHaveBeenLastCalledWith('update_ogabassey_guest_cart', {
    product_id: second.id,
    quantity: 1,
    cart_token: token,
  });
  expect(openExternal).not.toHaveBeenCalled();
  act(() => result.current.handleViewCart());
  expect(openExternal).toHaveBeenCalledWith({
    href: response([product, second]).structuredContent.cart_url,
  });
});
it('removes on the server before updating the persisted chat state', async () => {
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response([]));
  window.openai = { callTool, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  await act(async () => {
    await result.current.handleRemoveItem(product.id);
  });
  expect(result.current.cart).toEqual([]);
  expect(callTool).toHaveBeenLastCalledWith('update_ogabassey_guest_cart', {
    product_id: product.id,
    quantity: 0,
    cart_token: token,
  });
});
it('retains the cart when removal fails and rejects hostile handoff destinations', async () => {
  window.openai = {
    callTool: vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        structuredContent: {
          ...response().structuredContent,
          cart_url: 'https://evil.example/cart',
        },
      }),
    setWidgetState: vi.fn(),
  };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  await act(async () => {
    await result.current.handleRemoveItem(product.id);
  });
  expect(result.current.cart).toHaveLength(1);
  await act(async () => {
    await result.current.handleAddToCart(second);
  });
  expect(result.current.cart).toHaveLength(1);
});
it('re-adds with the incremented absolute total', async () => {
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response());
  window.openai = { callTool, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  expect(callTool).toHaveBeenLastCalledWith('update_ogabassey_guest_cart', {
    product_id: product.id,
    quantity: 2,
    cart_token: token,
  });
});
it('navigates a synchronously-opened tab when selection is required', async () => {
  const tab = { location: { href: '' }, closed: false, close: vi.fn() };
  const openSpy = vi.fn(() => tab);
  vi.stubGlobal('open', openSpy);
  const callTool = vi.fn().mockResolvedValue({
    structuredContent: {
      success: false,
      requires_variant_selection: true,
      product_id: product.id,
      product_url: 'https://ogabassey.com/products/phone',
    },
  });
  window.openai = { callTool, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank');
  expect(tab.location.href).toBe('https://ogabassey.com/products/phone');
  expect(tab.close).not.toHaveBeenCalled();
  expect(result.current.cart).toHaveLength(0);
});
it('closes the reserved tab when no navigation is needed', async () => {
  const tab = { location: { href: '' }, closed: false, close: vi.fn() };
  vi.stubGlobal(
    'open',
    vi.fn(() => tab)
  );
  const callTool = vi.fn().mockResolvedValue(response());
  window.openai = { callTool, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  expect(tab.close).toHaveBeenCalledOnce();
  expect(result.current.cart).toHaveLength(1);
});
it('does not silently select variants and preserves the existing guest cart', async () => {
  const openExternal = vi.fn();
  const callTool = vi.fn();
  window.openai = { openExternal, callTool };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart({
      ...product,
      url: 'https://ogabassey.com/products/phone?variantId=v1',
    });
  });
  expect(callTool).not.toHaveBeenCalled();
  expect(openExternal).toHaveBeenCalledWith({
    href: 'https://ogabassey.com/products/phone?variantId=v1',
  });
});
it('retries a stale token once without it and replaces state with the fresh cart', async () => {
  const fresh = 'b'.repeat(64);
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response([product, second]))
    .mockResolvedValueOnce(expiredResponse())
    .mockResolvedValueOnce(response([product], fresh));
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
  expect(callTool).toHaveBeenCalledTimes(4);
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
