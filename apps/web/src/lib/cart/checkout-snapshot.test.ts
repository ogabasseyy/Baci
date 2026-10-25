import { expect, it } from 'vitest';
import { parseSnapshot, validOperationId } from './checkout-snapshot';

it('rejects a partial checkout reply and unbounded operation IDs', () => {
  expect(parseSnapshot({ cartId: 'cart', lines: [] })).toBeNull();
  expect(validOperationId('a'.repeat(128))).toBe(true);
  expect(validOperationId('a'.repeat(129))).toBe(false);
});

it('rejects non-integer stock quantities in checkout lines', () => {
  const line = {
    available: true,
    effectiveUnitPriceMinor: 25000,
    hasAssurance: false,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
    options: {},
    priceChanged: false,
    productId: '33333333-3333-4333-8333-333333333333',
    quantity: 1,
    stockQty: 10,
    unavailableReason: null,
    validatedUnitPriceMinor: 25000,
    variantId: null,
    voucherAwardId: null,
    voucherToken: null,
  };
  const snapshot = {
    cartId: '22222222-2222-4222-8222-222222222222',
    cartVersion: 3,
    checkoutSessionId: '44444444-4444-4444-8444-444444444444',
    estimates: {
      currency: 'NGN',
      lineCount: 1,
      subtotalMinor: 25000,
      unavailableCount: 0,
    },
    generation: 1,
    lines: [line],
    merchantId: '11111111-1111-4111-8111-111111111111',
  };

  expect(parseSnapshot(snapshot)?.lines[0]?.stockQty).toBe(10);
  expect(parseSnapshot(snapshot)?.lines[0]?.offerId).toBeNull();
  const offerId = '55555555-5555-4555-8555-555555555555';
  expect(
    parseSnapshot({
      ...snapshot,
      lines: [{ ...line, offerId }],
    })?.lines[0]?.offerId
  ).toBe(offerId);
  expect(
    parseSnapshot({ ...snapshot, lines: [{ ...line, stockQty: 1.5 }] })
  ).toBeNull();
  expect(
    parseSnapshot({ ...snapshot, lines: [{ ...line, stockQty: Number.NaN }] })
  ).toBeNull();
});
