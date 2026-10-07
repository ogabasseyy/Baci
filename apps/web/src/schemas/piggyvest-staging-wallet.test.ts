import { describe, expect, it } from 'vitest';
import { piggyvestStagingWalletResponseSchema } from './piggyvest-staging-wallet';

describe('piggyvestStagingWalletResponseSchema', () => {
  it('retains the API customer alias without replacing the webhook customer identity', () => {
    const result = piggyvestStagingWalletResponseSchema.parse({
      status: true,
      data: {
        id: 'wallet',
        business_id: 'business',
        api_customer_id: 'api-customer-alias',
        currency: 'NGN',
        balance: 10000,
        status: 'active',
      },
    });
    expect(result.data.api_customer_id).toBe('api-customer-alias');
  });
  it('retains the provider balance without interpreting its units or spendability', () => {
    const providerBalance = 12_345;

    const result = piggyvestStagingWalletResponseSchema.parse({
      status: true,
      data: {
        id: 'wallet-synthetic',
        business_id: 'business-synthetic',
        currency: 'NGN',
        balance: providerBalance,
        status: 'provider-status',
      },
    });

    expect(result.data.balance).toBe(providerBalance);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '12.34',
    null,
  ])('rejects a non-finite numeric balance (%s)', (balance) => {
    expect(() =>
      piggyvestStagingWalletResponseSchema.parse({
        status: true,
        data: {
          id: 'wallet-synthetic',
          business_id: 'business-synthetic',
          currency: 'NGN',
          balance,
          status: 'provider-status',
        },
      })
    ).toThrow();
  });

  it('rejects an unsuccessful provider envelope', () => {
    expect(() =>
      piggyvestStagingWalletResponseSchema.parse({
        status: false,
        data: {},
      })
    ).toThrow();
  });
});
