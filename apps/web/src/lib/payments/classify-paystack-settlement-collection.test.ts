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

  it('returns null shares when fees_split is absent or malformed', () => {
    const base = { subaccount: { subaccount_code: 'ACCT_x' } };
    const nulls = {
      integrationShareKobo: null,
      mode: 'direct_split',
      subaccountCode: 'ACCT_x',
      subaccountShareKobo: null,
      transactionChargeKobo: null,
    };

    expect(classifyPaystackSettlementCollection(base)).toEqual(nulls);
    expect(
      classifyPaystackSettlementCollection({
        ...base,
        fees_split: {
          integration: -1,
          params: { transaction_charge: '12.5' },
          subaccount: 'abc',
        },
      })
    ).toEqual(nulls);
    expect(
      classifyPaystackSettlementCollection({
        ...base,
        fees_split: { integration: Number.MAX_SAFE_INTEGER + 2 },
      })
    ).toEqual(nulls);
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
        subaccount: { subaccount_code: 42 },
      })
    ).toEqual({ mode: 'integration' });
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
