import { describe, expect, it } from 'vitest';
import { resolveGuestCartTransfer } from './resolve-guest-cart-transfer';

const line = {
  product_id: '11111111-1111-4111-8111-111111111111',
  quantity: 3,
};

describe('resolveGuestCartTransfer', () => {
  it('returns item ids and per-product quantities', () => {
    const second = {
      product_id: '22222222-2222-4222-8222-222222222222',
      quantity: 1,
    };
    expect(resolveGuestCartTransfer(JSON.stringify([line, second]))).toEqual({
      itemIds: `${line.product_id},${second.product_id}`,
      quantities: new Map([
        [line.product_id, line.quantity],
        [second.product_id, second.quantity],
      ]),
    });
  });

  it('returns null for missing or invalid handoffs', () => {
    expect(resolveGuestCartTransfer(null)).toBeNull();
    expect(resolveGuestCartTransfer('bad')).toBeNull();
  });
});
