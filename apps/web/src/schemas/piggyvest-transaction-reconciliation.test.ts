import { describe, expect, it } from 'vitest';
import { piggyvestTransactionReconciliationSchema as schemas } from './piggyvest-transaction-reconciliation';

const data = {
  id: 'transaction-test',
  customer_id: 'customer-test',
  source_wallet: '',
  destination_wallet: 'wallet-test',
  status: 'new-provider-status',
  amount: 0.5,
  fee: 0,
  category: 'unknown',
  reference: 'reference-test',
  break_down: {
    gross_interest_payout: 0,
    withholding_tax: 0,
    net_interest_payout: 0,
  },
};

describe('documented transaction projection', () => {
  it('preserves numeric observations without assigning units or interpreting status/category', () => {
    expect(schemas.response.parse({ status: true, data })).toEqual({
      status: true,
      data,
    });
  });

  it('strips messages, arbitrary metadata, business claims, currency and nested extras', () => {
    expect(
      schemas.response.parse({
        status: true,
        message: 'private',
        data: {
          ...data,
          business_id: 'forged',
          currency: 'NGN',
          meta: { private: true },
          break_down: { ...data.break_down, eligible: true },
        },
      })
    ).toEqual({ status: true, data });
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '100',
    null,
  ])('rejects malformed numeric observations: %s', (amount) => {
    expect(
      schemas.response.safeParse({ status: true, data: { ...data, amount } })
        .success
    ).toBe(false);
  });

  it.each([
    'id',
    'customer_id',
    'source_wallet',
    'destination_wallet',
    'break_down',
  ])('fails closed without %s', (field) => {
    expect(
      schemas.response.safeParse({
        status: true,
        data: { ...data, [field]: undefined },
      }).success
    ).toBe(false);
  });

  it('requires a success envelope', () => {
    expect(schemas.response.safeParse({ status: false, data }).success).toBe(
      false
    );
  });

  it('rejects extra binding fields and missing timeout/byte limits', () => {
    expect(
      schemas.binding.safeParse({
        transactionId: 'tx',
        walletId: 'wallet',
        customerId: 'customer',
        businessId: 'business',
        url: 'https://example.test',
      }).success
    ).toBe(false);
    expect(
      schemas.configuration.safeParse({
        apiSecret: 'synthetic',
        expectedBusinessId: 'business',
      }).success
    ).toBe(false);
  });
});
