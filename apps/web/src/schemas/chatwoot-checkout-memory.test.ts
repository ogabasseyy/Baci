import { describe, expect, it } from 'vitest';
import { chatwootCheckoutMemorySchema } from './chatwoot-checkout-memory';

const entry = {
  merchantId: 'merchant-1',
  conversationId: 905,
  cartId: 'cart-test',
  order: {
    orderId: 'order-1',
    orderNumber: 'ORD-1',
    trackingToken: null,
    amountDueMajor: 1000,
    currency: 'NGN',
  },
  payment: {
    bank: {
      bankName: 'Test Bank',
      accountNumber: '0123456789',
      accountName: 'Test Store',
    },
    reference: 'ref-1',
    issuedAt: 1_700_000_000_000,
  },
};

describe('chatwootCheckoutMemorySchema', () => {
  it('accepts stored orders with and without issued bank details', () => {
    expect(
      chatwootCheckoutMemorySchema.safeParse([
        ['key-1', entry],
        ['key-2', { ...entry, payment: null }],
      ]).success
    ).toBe(true);
  });

  it('accepts Oxygen paymentMethod entries and rejects unsupported paymentMethod discriminators', () => {
    expect(
      chatwootCheckoutMemorySchema.safeParse([
        [
          'key-oxygen',
          {
            ...entry,
            order: { ...entry.order, paymentMethod: 'oxygen' },
            payment: null,
          },
        ],
      ]).success
    ).toBe(true);
    expect(
      chatwootCheckoutMemorySchema.safeParse([
        [
          'key-bad',
          {
            ...entry,
            order: { ...entry.order, paymentMethod: 'card' },
            payment: null,
          },
        ],
      ]).success
    ).toBe(false);
  });

  it('rejects extra fields, such as contact details, at every level', () => {
    for (const bad of [
      { ...entry, email: 'shopper@example.test' },
      { ...entry, order: { ...entry.order, phone: '+2348000000000' } },
      { ...entry, payment: { ...entry.payment, address: 'x' } },
    ]) {
      expect(
        chatwootCheckoutMemorySchema.safeParse([['key', bad]]).success
      ).toBe(false);
    }
  });

  it('rejects a non-positive amount and more than twenty orders', () => {
    expect(
      chatwootCheckoutMemorySchema.safeParse([
        ['key', { ...entry, order: { ...entry.order, amountDueMajor: 0 } }],
      ]).success
    ).toBe(false);
    expect(
      chatwootCheckoutMemorySchema.safeParse(
        Array.from({ length: 21 }, (_, index) => [`key-${index}`, entry])
      ).success
    ).toBe(false);
  });
});
