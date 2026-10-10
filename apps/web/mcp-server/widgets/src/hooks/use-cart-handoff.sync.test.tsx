import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCartHandoff } from './use-cart-handoff';
const product = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Phone',
  slug: 'phone',
  price: 90000,
};
const foreign = '22222222-2222-4222-8222-222222222222';
const token = 'a'.repeat(64);
function response(items: { product_id: string; quantity: number }[]) {
  const url = new URL('https://ogabassey.com/cart');
  url.searchParams.set('guest_cart', JSON.stringify(items));
  return {
    structuredContent: {
      success: true,
      cart_url: url.toString(),
      cart_token: token,
      items,
      expires_at: '2026-10-14T00:00:00.000Z',
    },
  };
}
beforeEach(() => {
  vi.stubGlobal('open', vi.fn(() => null));
});
afterEach(() => {
  delete window.openai;
  vi.unstubAllGlobals();
});
it('notices server lines added outside the widget instead of hiding them', async () => {
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(
      response([{ product_id: product.id, quantity: 1 }])
    )
    .mockResolvedValueOnce(
      response([
        { product_id: product.id, quantity: 1 },
        { product_id: foreign, quantity: 2 },
      ])
    );
  window.openai = { callTool, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  expect(result.current.cartNotice).toBeNull();
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  // The foreign line stays in the transfer URL but out of the shown cart,
  // so the mismatch is surfaced instead of surprising at checkout.
  expect(result.current.cart).toHaveLength(1);
  expect(result.current.cartNotice).toContain('another chat');
});
it('clears the notice when a later merge has no foreign lines', async () => {
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(
      response([
        { product_id: product.id, quantity: 1 },
        { product_id: foreign, quantity: 1 },
      ])
    )
    .mockResolvedValueOnce(
      response([{ product_id: product.id, quantity: 1 }])
    );
  window.openai = { callTool, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  expect(result.current.cartNotice).toContain('another chat');
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  expect(result.current.cartNotice).toBeNull();
});
it('notices foreign lines surviving a removal', async () => {
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(
      response([{ product_id: product.id, quantity: 1 }])
    )
    .mockResolvedValueOnce(response([{ product_id: foreign, quantity: 1 }]));
  window.openai = { callTool, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  expect(result.current.cartNotice).toBeNull();
  await act(async () => {
    await result.current.handleRemoveItem(product.id);
  });
  expect(result.current.cart).toHaveLength(0);
  expect(result.current.cartNotice).toContain('another chat');
});
