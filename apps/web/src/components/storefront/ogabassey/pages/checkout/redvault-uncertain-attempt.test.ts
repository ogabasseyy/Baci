import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRedvaultUncertainAttempt,
  readRedvaultUncertainAttempt,
  saveRedvaultUncertainAttempt,
} from './redvault-uncertain-attempt';

const merchantId = '11111111-1111-4111-8111-111111111111';
const orderRequest = {
  merchant_id: merchantId,
  customer_email: 'ada@example.test',
  customer_name: 'Ada Customer',
  customer_phone: '08000000000',
  items: [{ product_id: 'phone', name: 'Phone', quantity: 1, price: 100 }],
  subtotal: 100,
  payment_method: 'uba_redvault',
  shared_cart: {
    cart_id: '22222222-2222-4222-8222-222222222222',
    cart_version: 1,
    checkout_generation: 1,
    checkout_session_id: '44444444-4444-4444-8444-444444444444',
  },
};
const attempt: Parameters<typeof saveRedvaultUncertainAttempt>[0] = {
  merchantId,
  idempotencyKey: 'attempt-key',
  fingerprint: 'uba_redvault:example',
  customer: {
    email: 'ada@example.test',
    name: 'Ada Customer',
    phone: '08000000000',
  },
  billingAddress: {
    line1: 'Store pickup',
    city: 'Lagos',
    state: 'Lagos',
    country: 'NG',
  },
  orderRequest: orderRequest as never,
};

beforeEach(() => sessionStorage.clear());

describe('uncertain UBA order attempt', () => {
  it('keeps the exact request until the matching idempotency key clears it', () => {
    saveRedvaultUncertainAttempt(attempt);
    expect(readRedvaultUncertainAttempt(merchantId)).toMatchObject({
      kind: 'pending',
      attempt: { idempotencyKey: 'attempt-key', orderRequest },
    });
    clearRedvaultUncertainAttempt(merchantId, 'different-key');
    expect(readRedvaultUncertainAttempt(merchantId).kind).toBe('pending');
    clearRedvaultUncertainAttempt(merchantId, 'attempt-key');
    expect(readRedvaultUncertainAttempt(merchantId)).toEqual({ kind: 'none' });
  });

  it('refuses to overwrite an unresolved request with different details', () => {
    saveRedvaultUncertainAttempt(attempt);
    expect(() =>
      saveRedvaultUncertainAttempt({
        ...attempt,
        idempotencyKey: 'different-key',
      })
    ).toThrow(/previous UBA checkout/i);
    expect(readRedvaultUncertainAttempt(merchantId)).toMatchObject({
      kind: 'pending',
      attempt: { idempotencyKey: 'attempt-key' },
    });
  });

  it('rejects voucher credentials and malformed stored attempts', () => {
    const withVoucher = {
      ...orderRequest,
      items: [{ ...orderRequest.items[0], voucher_token: 'sensitive-voucher' }],
    };
    expect(() =>
      saveRedvaultUncertainAttempt({
        ...attempt,
        orderRequest: withVoucher as never,
      })
    ).toThrow();
    sessionStorage.setItem(
      `baci:uba-uncertain-checkout:${merchantId}`,
      '{invalid'
    );
    expect(readRedvaultUncertainAttempt(merchantId)).toEqual({
      kind: 'unavailable',
    });
  });
});
