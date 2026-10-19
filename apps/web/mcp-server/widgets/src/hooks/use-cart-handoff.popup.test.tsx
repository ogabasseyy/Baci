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
  vi.stubGlobal(
    'open',
    vi.fn(() => null)
  );
});

afterEach(() => {
  delete window.openai;
  vi.unstubAllGlobals();
});

it('reports a blocked reservation instead of retrying a popup after async option lookup', async () => {
  const openSpy = vi.fn(() => null);
  vi.stubGlobal('open', openSpy);
  window.openai = {
    callTool: vi.fn().mockResolvedValue({
      structuredContent: {
        success: false,
        requires_variant_selection: true,
        product_id: product.id,
        product_url: 'https://ogabassey.com/products/phone',
      },
    }),
    setWidgetState: vi.fn(),
  };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => {
    await result.current.handleAddToCart(product);
  });
  expect(result.current.cartError).toContain('Please allow popups');
  expect(openSpy).toHaveBeenCalledExactlyOnceWith('about:blank', '_blank');
});
