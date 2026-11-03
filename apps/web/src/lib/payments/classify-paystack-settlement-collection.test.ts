import { describe, expect, it } from 'vitest';
import { classifyPaystackSettlementCollection } from '@/lib/payments/classify-paystack-settlement-collection';

describe('classifyPaystackSettlementCollection', () => {
  it('classifies a subaccount-split transaction as direct_split with parsed shares', () => {
    const result = classifyPaystackSettlementCollection({
      fees_split: {
        integration: '5000',
        params: { bearer: 'account', transaction_charge: '205000' },
        paystack: 1500,
        subaccount: 1_000_000,
      },
      subaccount: { subaccount_code: ' ACCT_abc ' },
    });

    expect(result).toEqual({
      integrationShareKobo: 5000,
      mode: 'direct_split',
      subaccountCode: 'ACCT_abc',
      subaccountShareKobo: 1_000_000,
      transactionChargeKobo: 205_000,
    });
  });

  it('returns null for the optional shares it cannot parse', () => {
    expect(
      classifyPaystackSettlementCollection({
        fees_split: {
          integration: -1,
          params: { transaction_charge: '12.5' },
          subaccount: '250000',
        },
        subaccount: { subaccount_code: 'ACCT_x' },
      })
    ).toEqual({
      integrationShareKobo: null,
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
        fees_split: {
          integration: 480_000,
          params: { transaction_charge: '500000' },
          subaccount: 0,
        },
        subaccount: { subaccount_code: 'ACCT_x' },
      })
    ).toEqual({
      integrationShareKobo: 480_000,
      mode: 'direct_split',
      subaccountCode: 'ACCT_x',
      subaccountShareKobo: 0,
      transactionChargeKobo: 500_000,
    });
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

  it('classifies an empty or null subaccount as integration', () => {
    expect(classifyPaystackSettlementCollection({ subaccount: {} })).toEqual({
      mode: 'integration',
    });
    expect(classifyPaystackSettlementCollection({ subaccount: null })).toEqual({
      mode: 'integration',
    });
    expect(
      classifyPaystackSettlementCollection({
        subaccount: { subaccount_code: '   ' },
      })
    ).toEqual({ mode: 'integration' });
    expect(
      classifyPaystackSettlementCollection({
        subaccount: { subaccount_code: null },
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
