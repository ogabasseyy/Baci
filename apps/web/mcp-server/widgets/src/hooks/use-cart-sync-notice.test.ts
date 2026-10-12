import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import {
  describeSkippedSurvivorsNotice,
  useCartSyncNotice,
} from './use-cart-sync-notice';
import type { CartItem } from '../widget-types';

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

it('surfaces recovery-skipped removals through the same notice', () => {
  const { result } = renderHook(() => useCartSyncNotice());
  act(() => {
    result.current.syncCartNotice(
      [{ product_id: product.id, quantity: 1 }],
      [{ product, quantity: 1 }],
      product.id,
      [{ productId: foreignId, requiresVariantSelection: false }]
    );
  });
  expect(result.current.cartNotice).toContain('no longer available');
});

const camera = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Camera',
  slug: 'camera',
  price: 90000,
};
const cart: CartItem[] = [
  { product, quantity: 1 },
  { product: camera, quantity: 2 },
];

it('returns null when no survivor was skipped', () => {
  expect(describeSkippedSurvivorsNotice([], cart)).toBeNull();
});

it('names a single unavailable removal', () => {
  expect(
    describeSkippedSurvivorsNotice(
      [{ productId: camera.id, requiresVariantSelection: false }],
      cart
    )
  ).toBe('Camera is no longer available and was removed from your guest cart.');
});

it('counts multiple unavailable removals', () => {
  expect(
    describeSkippedSurvivorsNotice(
      [
        { productId: product.id, requiresVariantSelection: false },
        { productId: camera.id, requiresVariantSelection: false },
      ],
      cart
    )
  ).toBe(
    '2 items are no longer available and were removed from your guest cart.'
  );
});

it('points a selection-skipped survivor at its product page', () => {
  expect(
    describeSkippedSurvivorsNotice(
      [{ productId: product.id, requiresVariantSelection: true }],
      cart
    )
  ).toBe(
    'Phone now needs option selection and was removed from your guest cart; choose options on its product page to add it back.'
  );
});

it('combines both skip reasons and tolerates unknown ids', () => {
  expect(
    describeSkippedSurvivorsNotice(
      [
        { productId: camera.id, requiresVariantSelection: false },
        { productId: 'deadbeef', requiresVariantSelection: true },
      ],
      cart
    )
  ).toBe(
    'Camera is no longer available and was removed from your guest cart. ' +
      'An item now needs option selection and was removed from your guest cart; choose options on its product page to add it back.'
  );
});
