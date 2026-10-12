import { describe, expect, it } from 'vitest';
import { unsupportedRefundReasons } from './unsupported-refund-reasons';

const transaction = {
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: 'PAY-123',
  id: 'payment-id',
};

describe('unsupportedRefundReasons', () => {
  it('summarizes unsupported reasons', () => {
    expect(
      unsupportedRefundReasons([
        { ...transaction, gateway: null },
        { ...transaction, gateway: 'korapay', gateway_reference: null },
        { ...transaction, gateway: 'korapay', gateway_reference: null },
      ])
    ).toEqual(['missing gateway', 'korapay missing reference']);
  });
});
