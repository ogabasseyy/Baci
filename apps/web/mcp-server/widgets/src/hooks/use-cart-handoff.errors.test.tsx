import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCartHandoff } from './use-cart-handoff';
const product = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Phone',
  slug: 'phone',
  price: 90000,
};
beforeEach(() => {
  vi.stubGlobal('open', vi.fn(() => null));
});
afterEach(() => {
  delete window.openai;
  vi.unstubAllGlobals();
});
it('reports quota exhaustion with the retry wait instead of a product error', async () => {
  const callTool = vi.fn().mockResolvedValueOnce({
    structuredContent: {
      success: false,
      quota_exceeded: true,
      retry_after_seconds: 1800,
    },
  });
  window.openai = { callTool, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  expect(result.current.cart).toHaveLength(0);
  expect(result.current.cartError).toBe(
    'Too many guest carts were created from this address. Try again in about 30 minutes.'
  );
});
it('reports a full cart with removal guidance instead of a product error', async () => {
  const callTool = vi.fn().mockResolvedValueOnce({
    structuredContent: {
      success: false,
      cart_full: true,
    },
  });
  window.openai = { callTool, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  expect(result.current.cart).toHaveLength(0);
  expect(result.current.cartError).toBe(
    'Your guest cart already holds 20 products. Remove one to add another.'
  );
});
