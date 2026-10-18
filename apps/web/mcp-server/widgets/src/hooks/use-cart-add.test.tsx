import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDefaultState, type WidgetState } from '../widget-types';
import { createCartAddHandler } from './use-cart-add';

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

it('persists a validated guest-cart result after the server accepts an add', async () => {
  const url = new URL('https://ogabassey.com/cart');
  url.searchParams.set(
    'guest_cart',
    JSON.stringify([{ product_id: product.id, quantity: 1 }])
  );
  const callTool = vi.fn().mockResolvedValue({
    structuredContent: {
      success: true,
      cart_url: url.toString(),
      cart_token: 'a'.repeat(64),
    },
  });
  window.openai = { callTool };
  let persistedState: WidgetState | undefined;
  const setWidgetState = vi.fn(
    (state: WidgetState | ((previous: WidgetState) => WidgetState)) => {
      persistedState =
        typeof state === 'function' ? state(createDefaultState()) : state;
    }
  );
  const setCartError = vi.fn();
  const handler = createCartAddHandler({
    widgetState: null,
    setWidgetState,
    setCartError,
    setIsSavingCart: vi.fn(),
    syncCartNotice: vi.fn(),
    handoffRequestId: { current: 0 },
    busy: { current: false },
  });

  await handler(product);

  expect(callTool).toHaveBeenCalledWith('update_ogabassey_guest_cart', {
    product_id: product.id,
    quantity: 1,
    cart_token: undefined,
  });
  expect(setWidgetState).toHaveBeenCalledOnce();
  expect(persistedState?.cart).toEqual([{ product, quantity: 1 }]);
  expect(setCartError).toHaveBeenCalledWith(null);
});
