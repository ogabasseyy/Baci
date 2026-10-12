import { describe, expect, it } from 'vitest';
import { initializeTransactionMetadata } from './initialize-transaction-metadata';

describe('initializeTransactionMetadata', () => {
  it('marks a Paystack DVA placeholder for safe missing-reference retirement', () => {
    expect(
      initializeTransactionMetadata({ gateway: 'paystack', paymentType: 'dva' })
    ).toEqual({ paystack_payment_type: 'dva' });
  });

  it('does not mark a card payment as DVA', () => {
    expect(initializeTransactionMetadata({ gateway: 'paystack' })).toEqual({});
  });

  it('retains Juicyway settlement evidence', () => {
    expect(
      initializeTransactionMetadata({
        gateway: 'juicyway',
        cryptoPayment: {
          currency: 'USDT',
          expected_session_amount: 326,
          conversion_rate: 1450,
        },
      })
    ).toEqual({
      juicyway_expected_amount: 326,
      juicyway_expected_currency: 'USDT',
      juicyway_fx_rate: 1450,
    });
  });
});
