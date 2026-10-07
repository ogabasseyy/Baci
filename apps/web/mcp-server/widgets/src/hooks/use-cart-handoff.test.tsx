import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
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
function response(products = [product]) {
  const url = new URL('https://ogabassey.com/cart');
  url.searchParams.set(
    'guest_cart',
    JSON.stringify(
      products.map((item) => ({ product_id: item.id, quantity: 1 }))
    )
  );
  return {
    structuredContent: {
      success: true,
      cart_url: url.toString(),
      cart_token: token,
    },
  };
}
afterEach(() => {
  delete window.openai;
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
