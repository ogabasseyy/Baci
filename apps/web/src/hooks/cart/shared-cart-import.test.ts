import type { CartLine, CartSnapshot } from '@baci/shared/cart';

import { describe, expect, it } from 'vitest';

import type { Product } from '@/lib/products';

import type { CartItem } from './cart-types';

import { planLegacyImport } from './shared-cart-reducer';

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

describe('planLegacyImport', () => {
  it('returns nothing when the legacy cache is empty', () => {
    expect(planLegacyImport([], null, null)).toEqual({ kind: 'nothing' });
  });

  it('plans a create-with-lines import with a stable operation key', () => {
    const local = [
      cartItem({ id: 'prod-1', quantity: 2 }),
      cartItem({
        id: 'prod-2',
        negotiatedPrice: 50,
        negotiationStatus: 'accepted',
        quantity: 1,
      }),
    ];
    const first = planLegacyImport(local, null, null);
    const second = planLegacyImport(local, null, null);

    expect(first).toMatchObject({ kind: 'create' });
    if (first.kind !== 'create' || second.kind !== 'create') {
      throw new Error('expected create plans');
    }
    expect(first.lines).toHaveLength(2);
    expect(first.lines[0]).toMatchObject({ quantity: 2 });
    expect(first.lines[1].negotiatedUnitPriceMinor).toBe(5000);
    // Derived keys converge retries instead of duplicating the import.
    expect(first.operationId).toBe(second.operationId);
    expect(first.operationId.length).toBeLessThanOrEqual(128);
  });

  it('plans per-line adds when the server cart exists but is empty', () => {
    const planned = planLegacyImport(
      [cartItem({ id: 'prod-1', quantity: 2 })],
      snapshot({ lines: [], version: 1 }),
      CART_ID
    );

    expect(planned).toMatchObject({ kind: 'commands' });
    if (planned.kind !== 'commands') throw new Error('expected commands plan');
    expect(planned.adds).toHaveLength(1);
    expect(planned.sets).toHaveLength(0);
    expect(planned.adds[0].operationId).toContain(CART_ID);
  });

  it('diffs a nonempty server cart into adds and quantity sets', () => {
    const planned = planLegacyImport(
      [
        cartItem({ id: 'prod-1', quantity: 3 }),
        cartItem({ id: 'prod-9', quantity: 1 }),
      ],
      snapshot({ version: 2 }),
      CART_ID
    );

    expect(planned).toMatchObject({ kind: 'commands' });
    if (planned.kind !== 'commands') throw new Error('expected commands plan');
    // prod-1 exists with qty 1 locally 3 → max wins via set to 3.
    expect(planned.sets).toEqual([{ lineId: 'line-1', quantity: 3 }]);
    expect(planned.adds).toHaveLength(1);
    expect(planned.adds[0].line.item).toEqual({ productId: 'prod-9' });
  });

  it('reports conflicts instead of silently overwriting attachments', () => {
    const planned = planLegacyImport(
      [
        cartItem({
          id: 'prod-1',
          quantity: 1,
          quizAwardId: 'award-1',
          quizVoucherToken: 'token-1',
        }),
      ],
      snapshot({ version: 2 }),
      CART_ID
    );

    expect(planned).toMatchObject({ kind: 'conflicts' });
    if (planned.kind !== 'conflicts') {
      throw new Error('expected conflicts plan');
    }
    expect(planned.conflicts).toHaveLength(1);
    expect(planned.conflicts[0].item).toEqual({ productId: 'prod-1' });
  });

  it('truncates beyond the line cap with an explicit warning', () => {
    const local = Array.from({ length: 25 }, (_, index) =>
      cartItem({ id: `prod-${index}`, quantity: 1 })
    );
    const planned = planLegacyImport(local, null, null);

    expect(planned).toMatchObject({ kind: 'create' });
    if (planned.kind !== 'create') throw new Error('expected create plan');
    expect(planned.lines).toHaveLength(20);
    expect(planned.warnings).toEqual(['too_many_lines']);
  });
});
