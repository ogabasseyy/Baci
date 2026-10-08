import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useCartSyncNotice } from './use-cart-sync-notice';

const product = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Phone',
  slug: 'phone',
  price: 90000,
};
const foreignId = '22222222-2222-4222-8222-222222222222';

it('starts without a notice', () => {
  const { result } = renderHook(() => useCartSyncNotice());
  expect(result.current.cartNotice).toBeNull();
});

it('notices server lines missing from the local cart', () => {
  const { result } = renderHook(() => useCartSyncNotice());
  act(() => {
    result.current.syncCartNotice(
      [
        { product_id: product.id, quantity: 1 },
        { product_id: foreignId, quantity: 2 },
      ],
      [{ product, quantity: 1 }],
      product.id
    );
  });
  expect(result.current.cartNotice).toContain('another chat');
});

it('ignores the just-saved product and known lines', () => {
  const { result } = renderHook(() => useCartSyncNotice());
  act(() => {
    result.current.syncCartNotice(
      [{ product_id: product.id, quantity: 1 }],
      [],
      product.id
    );
  });
  expect(result.current.cartNotice).toBeNull();
});

it('clears the notice when a later merge has no foreign lines', () => {
  const { result } = renderHook(() => useCartSyncNotice());
  act(() => {
    result.current.syncCartNotice(
      [{ product_id: foreignId, quantity: 1 }],
      [],
      product.id
    );
  });
  expect(result.current.cartNotice).toContain('another chat');
  act(() => {
    result.current.syncCartNotice(
      [{ product_id: product.id, quantity: 1 }],
      [{ product, quantity: 1 }],
      product.id
    );
  });
  expect(result.current.cartNotice).toBeNull();
});
