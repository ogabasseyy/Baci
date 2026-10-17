import {
  type CartLine,
  type CartSnapshot,
  cartLineIdentity,
} from '@baci/shared/cart';

import { describe, expect, it } from 'vitest';

import type { Product } from '@/lib/products';

import type { CartItem } from './cart-types';

import {
  cartItemToIdentity,
  displayLineToInputLine,
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

describe('shared-cart-reducer confirmed display hygiene', () => {
  it('resets negotiated fields the server snapshot does not carry', () => {
    const cached = [
      cartItem({
        assuranceRate: 0.09,
        hasAssurance: true,
        id: 'prod-1',
        negotiatedPrice: 80,
        negotiationStatus: 'accepted',
      }),
    ];
    const started = sharedCartReducer(initialSharedCartState, {
      cached,
      generation: 1,
      merchantId: MERCHANT_ID,
      products: {
        // The hook seeds product shells from the cache itself, so stale
        // negotiated fields ride along unless adoption resets them.
        [cartLineIdentity({ productId: 'prod-1' })]:
          cached[0] as unknown as Product,
      },
      type: 'link/start',
    });
    const state = sharedCartReducer(started, {
      generation: 1,
      snapshot: snapshot({ version: 4 }),
      type: 'link/snapshot',
    });

    expect(state.display[0]).toMatchObject({
      assuranceRate: undefined,
      hasAssurance: false,
      negotiatedPrice: undefined,
      negotiationStatus: 'none',
    });
  });

  it('shows reprice attachments on the optimistic replacement line', () => {
    const added = sharedCartReducer(linked(), {
      entry: {
        intent: {
          kind: 'add',
          attachments: {
            negotiatedUnitPriceMinor: 7500,
            negotiationStatus: 'accepted',
          },
          product: product({ id: 'prod-9', price: 100 }),
          quantity: 1,
          tempId: 'temp-1',
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });

    expect(added.display[1]).toMatchObject({
      negotiatedPrice: 75,
      negotiationStatus: 'accepted',
      pendingTempId: 'temp-1',
    });
  });

  it('targets cached lines by identity before the server knows them', () => {
    const cached = [cartItem({ id: 'prod-9', quantity: 2 })];
    const started = sharedCartReducer(initialSharedCartState, {
      cached,
      generation: 1,
      merchantId: MERCHANT_ID,
      products: {},
      type: 'link/start',
    });
    const key = cartLineIdentity({ productId: 'prod-9' });
    const updated = sharedCartReducer(started, {
      entry: {
        intent: {
          kind: 'set_quantity',
          quantity: 5,
          target: { kind: 'identity', key },
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    expect(updated.display[0].quantity).toBe(5);

    const removed = sharedCartReducer(updated, {
      entry: {
        intent: { kind: 'remove', target: { kind: 'identity', key } },
        operationId: 'op-2',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    expect(removed.display).toHaveLength(0);
  });
});

describe('shared-cart identity mappers', () => {
  it('folds color and storage into the server identity options', () => {
    expect(
      cartItemToIdentity(
        cartItem({
          condition: 'new',
          id: 'prod-1',
          selectedColor: 'Black',
          selectedStorage: '256GB',
          variantAttributes: { storage: '256GB' },
          variantId: 'var-1',
        })
      )
    ).toEqual({
      condition: 'new',
      options: {
        color: 'Black',
        storage: '256GB',
      },
      productId: 'prod-1',
      variantId: 'var-1',
    });
  });

  it('converts display lines to input lines with minor-unit attachments', () => {
    expect(
      displayLineToInputLine(
        cartItem({
          condition: 'used',
          id: 'prod-1',
          negotiatedPrice: 89.5,
          negotiationStatus: 'accepted',
          quantity: 2,
          quizAwardId: 'award-1',
          quizVoucherToken: 'token-1',
          variantId: 'var-1',
        })
      )
    ).toEqual({
      item: {
        condition: 'used',
        productId: 'prod-1',
        variantId: 'var-1',
      },
      negotiatedUnitPriceMinor: 8950,
      negotiationStatus: 'accepted',
      // Voucher lines pin to quantity 1, mirroring the server rule.
      quantity: 1,
      voucherAwardId: 'award-1',
      voucherToken: 'token-1',
    });
  });

  it('drops unsettled negotiation states from the input line', () => {
    const line = displayLineToInputLine(
      cartItem({ negotiationStatus: 'pending', quantity: 1 })
    );
    expect(line.negotiationStatus).toBe('pending');
    expect(line.negotiatedUnitPriceMinor).toBeUndefined();

    const none = displayLineToInputLine(
      cartItem({ negotiationStatus: 'none', quantity: 1 })
    );
    expect(none.negotiationStatus).toBeUndefined();
  });
});

it('preserves every confirmed option for checkout item identity', () => {
  const options = {
    color: 'Blue',
    colorValue: '#00f',
    secondaryColor: 'Black',
    secondaryColorValue: '#000',
    storage: '256GB',
    custom: 'verbatim',
  };
  const state = linked(3, [
    cartLine({ item: { productId: 'prod-1', options } }),
  ]);
  expect(state.display[0].variantAttributes).toEqual(options);
});
