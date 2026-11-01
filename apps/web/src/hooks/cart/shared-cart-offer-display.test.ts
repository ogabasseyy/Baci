import type { CartLine } from '@baci/shared/cart';
import { expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import {
  initialSharedCartState,
  sharedCartReducer,
} from './shared-cart-reducer';

function product(overrides: Record<string, unknown> = {}): Product {
  return {
    brand: 'Brand',
    description: '',
    gtin: '',
    id: 'prod-1',
    image: '/prod-1.png',
    imageHint: 'product',
    imageLarge: '/prod-1-large.png',
    manage_stock: false,
    mpn: '',
    name: 'Phone',
    price: 100,
    slug: 'phone',
    status: 'active',
    stock: 10,
    ...overrides,
  } as Product;
}
function linked(version: number, lines: CartLine[]) {
  const state = sharedCartReducer(initialSharedCartState, {
    type: 'link/start',
    generation: 1,
    merchantId: '11111111-1111-4111-8111-111111111111',
    cached: [],
    products: {},
  });
  return sharedCartReducer(state, {
    type: 'link/snapshot',
    generation: 1,
    snapshot: {
      cartId: '22222222-2222-4222-8222-222222222222',
      currency: 'NGN',
      estimatedTotals: false,
      expiresAt: '2099-01-01T00:00:00Z',
      lines,
      merchantId: '11111111-1111-4111-8111-111111111111',
      state: 'active',
      subtotalMinor: 0,
      totalMinor: 0,
      version,
    },
  });
}

it('merges pending adds using the offer selected in options', () => {
  const offerId = '33333333-3333-4333-8333-333333333333';
  let state = linked(3, []);
  for (const suffix of ['1', '2']) {
    state = sharedCartReducer(state, {
      type: 'command/enqueue',
      generation: 1,
      entry: {
        operationId: `op-${suffix}`,
        intent: {
          kind: 'add',
          product: product(),
          quantity: 1,
          tempId: `temp-${suffix}`,
          options: { offerId },
        },
      },
    });
  }
  expect(state.display).toHaveLength(1);
  expect(state.display[0]).toMatchObject({ offerId, quantity: 2 });
});

it('clears a stale product-shell offer when the add intent selects no offer', () => {
  const state = sharedCartReducer(linked(3, []), {
    type: 'command/enqueue',
    generation: 1,
    entry: {
      operationId: 'op-1',
      intent: {
        kind: 'add',
        product: product({ offerId: 'stale-offer' }),
        quantity: 1,
        tempId: 'temp-1',
      },
    },
  });
  expect(state.display[0].offerId).toBeUndefined();
});

it('uses a prebuilt import identity ahead of stale add options', () => {
  const offerId = '33333333-3333-4333-8333-333333333333';
  const state = sharedCartReducer(linked(3, []), {
    type: 'command/enqueue',
    generation: 1,
    entry: {
      operationId: 'op-import',
      intent: {
        kind: 'add',
        product: product(),
        quantity: 1,
        tempId: 'temp-import',
        options: { offerId: 'stale-option-offer' },
        input: { item: { productId: 'prod-1', offerId }, quantity: 1 },
      },
    },
  });
  expect(state.display[0].offerId).toBe(offerId);
});
