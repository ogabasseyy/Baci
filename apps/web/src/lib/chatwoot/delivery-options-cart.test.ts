// @vitest-environment node

import type { CartLine, CartSnapshot } from '@baci/shared/cart';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  haveSameChatwootDeliveryOptionLines,
  isChatwootDeliveryOptionsCartValid,
} from './delivery-options-cart';

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: 'line-1',
    item: { productId: 'product-1' },
    quantity: 2,
    unitPriceMinor: 50_000,
    lineTotalMinor: 100_000,
    ...overrides,
  };
}

function cart(overrides: Partial<CartSnapshot> = {}): CartSnapshot {
  return {
    cartId: 'cart-1',
    merchantId: 'merchant-1',
    state: 'active',
    version: 3,
    currency: 'NGN',
    subtotalMinor: 100_000,
    totalMinor: 100_000,
    estimatedTotals: false,
    expiresAt: '2026-11-20T00:00:00.000Z',
    lines: [line()],
    ...overrides,
  } as CartSnapshot;
}

describe('isChatwootDeliveryOptionsCartValid', () => {
  it('accepts a consistent NGN cart', () => {
    expect(isChatwootDeliveryOptionsCartValid(cart())).toBe(true);
  });

  it.each([
    ['non-NGN currency', { currency: 'USD' }],
    ['estimated totals', { estimatedTotals: true }],
    ['negative version', { version: -1 }],
    ['fractional version', { version: 1.5 }],
    ['negative subtotal', { subtotalMinor: -1 }],
    ['subtotal not matching lines', { subtotalMinor: 99_999 }],
    ['no lines', { lines: [], subtotalMinor: 0 }],
    [
      'too many lines',
      {
        lines: Array.from({ length: 21 }, (_, i) =>
          line({ id: `l${i}`, quantity: 1, lineTotalMinor: 1 })
        ),
        subtotalMinor: 21,
      },
    ],
  ] as const)('rejects %s', (_name, overrides) => {
    expect(
      isChatwootDeliveryOptionsCartValid(
        cart(overrides as Partial<CartSnapshot>)
      )
    ).toBe(false);
  });

  it.each([
    ['empty line id', { id: '' }],
    ['empty product id', { item: { productId: '' } }],
    ['zero quantity', { quantity: 0, lineTotalMinor: 0 }],
    ['fractional quantity', { quantity: 1.5 }],
    ['negative unit price', { unitPriceMinor: -1 }],
    ['negative line total', { lineTotalMinor: -100_000 }],
  ] as const)('rejects a line with %s', (_name, overrides) => {
    const bad = line(overrides as Partial<CartLine>);
    expect(
      isChatwootDeliveryOptionsCartValid(
        cart({ lines: [bad], subtotalMinor: bad.lineTotalMinor })
      )
    ).toBe(false);
  });
});

describe('haveSameChatwootDeliveryOptionLines', () => {
  it('treats identical lines (and option key order) as the same', () => {
    const a = line({ item: { productId: 'p', options: { a: '1', b: '2' } } });
    const b = line({ item: { productId: 'p', options: { b: '2', a: '1' } } });
    expect(haveSameChatwootDeliveryOptionLines([a], [b])).toBe(true);
  });

  it.each([
    ['quantity', { quantity: 3 }],
    ['unit price', { unitPriceMinor: 40_000 }],
    ['line total', { lineTotalMinor: 90_000 }],
    ['variant', { item: { productId: 'product-1', variantId: 'v2' } }],
    ['condition', { item: { productId: 'product-1', condition: 'used' } }],
    ['options', { item: { productId: 'product-1', options: { c: 'x' } } }],
    ['voucher', { voucherToken: 'v' }],
    ['assurance', { hasAssurance: true }],
    ['negotiation', { negotiationStatus: 'accepted' }],
    ['line id', { id: 'line-2' }],
  ] as const)('detects a same-version change in %s', (_name, overrides) => {
    expect(
      haveSameChatwootDeliveryOptionLines(
        [line()],
        [line(overrides as Partial<CartLine>)]
      )
    ).toBe(false);
  });

  it('detects added, removed and reordered lines', () => {
    const a = line();
    const b = line({ id: 'line-2' });
    expect(haveSameChatwootDeliveryOptionLines([a], [a, b])).toBe(false);
    expect(haveSameChatwootDeliveryOptionLines([a, b], [b, a])).toBe(false);
  });
});
