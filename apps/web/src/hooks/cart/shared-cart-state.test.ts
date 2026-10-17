import type { CartLine, CartSnapshot } from '@baci/shared/cart';

import { describe, expect, it } from 'vitest';

import type { Product } from '@/lib/products';

import type { CartItem } from './cart-types';

import {
  deriveSyncStatus,
  initialSharedCartState,
  sharedCartReducer,
} from './shared-cart-reducer';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

const CART_ID = '22222222-2222-4222-8222-222222222222';

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

function cartItem(overrides: Record<string, unknown> = {}): CartItem {
  return {
    ...product(),
    cartItemId: 'prod-1',
    quantity: 1,
    ...overrides,
  } as CartItem;
}

function cartLine(overrides: Record<string, unknown> = {}): CartLine {
  return {
    id: 'line-1',
    item: { productId: 'prod-1' },
    lineTotalMinor: 10000,
    quantity: 1,
    unitPriceMinor: 10000,
    ...overrides,
  } as CartLine;
}

function snapshot(overrides: Record<string, unknown> = {}): CartSnapshot {
  const lines = (overrides.lines as CartLine[] | undefined) ?? [cartLine()];
  const subtotalMinor = lines.reduce(
    (sum, line) => sum + line.lineTotalMinor,
    0
  );
  return {
    cartId: CART_ID,
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2026-10-19T04:00:00.000Z',
    lines,
    merchantId: MERCHANT_ID,
    state: 'active',
    subtotalMinor,
    totalMinor: subtotalMinor,
    version: 3,
    ...overrides,
  } as CartSnapshot;
}

function linked(version = 3, lines: CartLine[] = [cartLine()]) {
  let state = initialSharedCartState;
  state = sharedCartReducer(state, {
    cached: [],
    generation: 1,
    merchantId: MERCHANT_ID,
    products: {},
    type: 'link/start',
  });
  return sharedCartReducer(state, {
    generation: 1,
    snapshot: snapshot({ lines, version }),
    type: 'link/snapshot',
  });
}

describe('shared-cart-reducer link', () => {
  it('seeds the display from the legacy cache before adopting', () => {
    const cached = [cartItem({ id: 'cached-1', name: 'Cached' })];
    const state = sharedCartReducer(initialSharedCartState, {
      cached,
      generation: 1,
      merchantId: MERCHANT_ID,
      products: {},
      type: 'link/start',
    });

    expect(state.display.map((line) => line.id)).toEqual(['cached-1']);
    expect(state.cartId).toBeNull();
    expect(state.confirmed).toBeNull();
    expect(deriveSyncStatus(state)).toBe('synced');
  });

  it('adopts the server snapshot and converts minor units at the boundary', () => {
    const state = sharedCartReducer(linked(), {
      generation: 1,
      snapshot: snapshot({
        lines: [
          cartLine({
            id: 'line-9',
            lineTotalMinor: 30000,
            quantity: 2,
            unitPriceMinor: 15000,
          }),
        ],
        version: 4,
      }),
      type: 'link/snapshot',
    });

    expect(state.cartId).toBe(CART_ID);
    expect(state.confirmed?.version).toBe(4);
    expect(state.display).toHaveLength(1);
    expect(state.display[0]).toMatchObject({
      id: 'prod-1',
      price: 150,
      quantity: 2,
      serverLineId: 'line-9',
    });
    expect(deriveSyncStatus(state)).toBe('synced');
  });

  it('refuses snapshots from another merchant', () => {
    const state = sharedCartReducer(linked(), {
      generation: 1,
      snapshot: snapshot({
        merchantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        version: 9,
      }),
      type: 'link/snapshot',
    });

    expect(state.confirmed?.version).toBe(3);
    expect(state.cartId).toBe(CART_ID);
  });

  it('resets everything on a session generation change', () => {
    const before = sharedCartReducer(linked(), {
      entry: {
        intent: {
          kind: 'add',
          product: product({ id: 'prod-9' }),
          quantity: 1,
          tempId: 'temp-1',
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    expect(before.display).toHaveLength(2);

    const state = sharedCartReducer(before, {
      generation: 2,
      merchantId: MERCHANT_ID,
      type: 'session/reset',
    });

    expect(state.generation).toBe(2);
    expect(state.display).toEqual([]);
    expect(state.queue).toEqual([]);
    expect(state.confirmed).toBeNull();
    expect(state.cartId).toBeNull();
  });

  it('ignores every action from a stale generation', () => {
    const state = linked();
    const stale = [
      {
        generation: 0,
        snapshot: snapshot({ version: 9 }),
        type: 'link/snapshot',
      },
      {
        entry: {
          intent: {
            kind: 'add',
            product: product(),
            quantity: 1,
            tempId: 'temp-x',
          },
          operationId: 'op-x',
        },
        generation: 0,
        type: 'command/enqueue',
      },
      {
        generation: 0,
        operationId: 'op-x',
        snapshot: snapshot({ version: 9 }),
        type: 'command/reconciled',
      },
      {
        generation: 0,
        snapshot: snapshot({ version: 9 }),
        type: 'snapshot/polled',
      },
    ] as const;

    for (const action of stale) {
      const next = sharedCartReducer(state, action);
      expect(next).toBe(state);
    }
  });
});
