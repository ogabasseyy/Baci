import { describe, expect, it } from 'vitest';
import { classifyPaystackSettlementCollection } from '@/lib/payments/classify-paystack-settlement-collection';

describe('classifyPaystackSettlementCollection', () => {
  it('classifies a subaccount-split transaction as direct_split with parsed shares', () => {
    // Paystack's split always adds up: merchant + Baci + Paystack = amount.
    const result = classifyPaystackSettlementCollection({
      amount: 1_006_500,
      fees_split: {
        integration: '5000',
        params: { bearer: 'account', transaction_charge: '205000' },
        paystack: 1500,
        subaccount: 1_000_000,
      },
      subaccount: { subaccount_code: ' ACCT_abc ' },
    });

    expect(result).toEqual({
      amountKobo: 1_006_500,
      integrationShareKobo: 5000,
      mode: 'direct_split',
      subaccountCode: 'ACCT_abc',
      subaccountShareKobo: 1_000_000,
      transactionChargeKobo: 205_000,
    });
  });

  it('accepts a bank-transfer split where Paystack takes its fee from the merchant share', () => {
    // Production DVA shape: no transaction_charge, Baci gets 0.
    expect(
      classifyPaystackSettlementCollection({
        amount: '83500000',
        fees_split: {
          integration: 0,
          paystack: 30_000,
          subaccount: 83_470_000,
        },
        subaccount: { subaccount_code: 'ACCT_x' },
      })
    ).toEqual({
      amountKobo: 83_500_000,
      integrationShareKobo: 0,
      mode: 'direct_split',
      subaccountCode: 'ACCT_x',
      subaccountShareKobo: 83_470_000,
      transactionChargeKobo: null,
    });
  });

  it('returns null for a transaction charge it cannot parse', () => {
    expect(
      classifyPaystackSettlementCollection({
        amount: 260_000,
        fees_split: {
          integration: 5_000,
          params: { transaction_charge: '12.5' },
          paystack: 5_000,
          subaccount: '250000',
        },
        subaccount: { subaccount_code: 'ACCT_x' },
      })
    ).toEqual({
      amountKobo: 260_000,
      integrationShareKobo: 5_000,
      mode: 'direct_split',
      subaccountCode: 'ACCT_x',
      subaccountShareKobo: 250_000,
      transactionChargeKobo: null,
    });
  });

  it("accepts a proven zero merchant share when Baci's charge took the whole payment", () => {
    // Checkout clamps fee + delivery to the payable amount, so the merchant
    // share can legitimately be 0; it is still verified, so it must settle.
    expect(
      classifyPaystackSettlementCollection({
        amount: 500_000,
        fees_split: {
          integration: 480_000,
          params: { transaction_charge: '500000' },
          paystack: 20_000,
          subaccount: 0,
        },
        subaccount: { subaccount_code: 'ACCT_x' },
      })
    ).toEqual({
      amountKobo: 500_000,
      integrationShareKobo: 480_000,
      mode: 'direct_split',
      subaccountCode: 'ACCT_x',
      subaccountShareKobo: 0,
      transactionChargeKobo: 500_000,
    });
  });

  it('fails closed to unknown when the split shares do not add up to the amount', () => {
    const split = { integration: 5_000, paystack: 195_000, subaccount: 1 };
    const named = { subaccount: { subaccount_code: 'ACCT_x' } };

    for (const payload of [
      // A 1-kobo merchant share on a ₦20,000 sale.
      { ...named, amount: 2_000_000, fees_split: split },
      // The amount, Baci's share or Paystack's fee is missing or malformed.
      { ...named, fees_split: split },
      { ...named, amount: 'abc', fees_split: split },
      {
        ...named,
        amount: 200_001,
        fees_split: { ...split, paystack: undefined },
      },
      { ...named, amount: 200_001, fees_split: { ...split, integration: -1 } },
    ]) {
      expect(classifyPaystackSettlementCollection(payload)).toEqual({
        mode: 'unknown',
      });
    }
  });

  it('fails closed to unknown when a named subaccount has no provable merchant share', () => {
    const base = { subaccount: { subaccount_code: 'ACCT_x' } };

    for (const payload of [
      base,
      { ...base, fees_split: null },
      { ...base, fees_split: { integration: 5000 } },
      { ...base, fees_split: { subaccount: 'abc' } },
      { ...base, fees_split: { subaccount: Number.MAX_SAFE_INTEGER + 2 } },
    ]) {
      expect(classifyPaystackSettlementCollection(payload)).toEqual({
        mode: 'unknown',
      });
    }
  });

  it('classifies the production Baci-collected shape as integration', () => {
    // Every production Baci-collected payment: empty subaccount, fees_split null.
    for (const subaccount of [
      {},
      null,
      { subaccount_code: '   ' },
      { subaccount_code: null },
    ]) {
      expect(
        classifyPaystackSettlementCollection({ fees_split: null, subaccount })
      ).toEqual({ mode: 'integration' });
    }
  });

  it('fails closed to unknown when an empty subaccount comes with a malformed fees_split', () => {
    // Only fees_split: null (the production shape) or a split showing a zero
    // merchant share proves Baci collected the money.
    for (const fees_split of [
      {},
      'x',
      [],
      { subaccount: 'abc' },
      { subaccount: -1 },
    ]) {
      expect(
        classifyPaystackSettlementCollection({ fees_split, subaccount: {} })
      ).toEqual({ mode: 'unknown' });
    }
  });

  it('fails closed to unknown when an empty subaccount comes without any fees_split', () => {
    // No split data at all proves nothing, so it must not credit the wallet.
    for (const subaccount of [{}, null, { subaccount_code: '' }]) {
      expect(classifyPaystackSettlementCollection({ subaccount })).toEqual({
        mode: 'unknown',
      });
    }
  });

  it('fails closed to unknown when an empty subaccount contradicts a positive merchant share', () => {
    // Paystack's own split shows money went to a subaccount; crediting the
    // Baci wallet would double-pay the sale.
    for (const subaccount of [{}, null, { subaccount_code: '' }]) {
      expect(
        classifyPaystackSettlementCollection({
          fees_split: { subaccount: 990_000 },
          subaccount,
        })
      ).toEqual({ mode: 'unknown' });
    }
    // A zero or absent merchant share is consistent with Baci collecting it.
    expect(
      classifyPaystackSettlementCollection({
        fees_split: { subaccount: 0 },
        subaccount: {},
      })
    ).toEqual({ mode: 'integration' });
  });

  it('fails closed to unknown when subaccount_code is present but not a string', () => {
    // A non-string code could still be a real split; crediting the Baci
    // wallet on that guess would fail open.
    for (const code of [42, true, { id: 'ACCT_x' }, ['ACCT_x']]) {
      expect(
        classifyPaystackSettlementCollection({
          fees_split: { subaccount: 990_000 },
          subaccount: { subaccount_code: code },
        })
      ).toEqual({ mode: 'unknown' });
    }
  });

  it('classifies anything without a subaccount key as unknown', () => {
    expect(classifyPaystackSettlementCollection({ fees: 100 })).toEqual({
      mode: 'unknown',
    });
    expect(classifyPaystackSettlementCollection(null)).toEqual({
      mode: 'unknown',
    });
    expect(classifyPaystackSettlementCollection('x')).toEqual({
      mode: 'unknown',
    });
    expect(classifyPaystackSettlementCollection([])).toEqual({
      mode: 'unknown',
    });
    expect(classifyPaystackSettlementCollection(undefined)).toEqual({
      mode: 'unknown',
    });
  });

  it('fails closed to unknown when subaccount is a bare string or number', () => {
    expect(
      classifyPaystackSettlementCollection({ subaccount: 'ACCT_x' })
    ).toEqual({ mode: 'unknown' });
    expect(classifyPaystackSettlementCollection({ subaccount: 7 })).toEqual({
      mode: 'unknown',
    });
  });
});
