import { describe, expect, it } from 'vitest';
import {
  merchantShippingWalletBalanceSchema,
  merchantWalletFundingAccountRowsSchema,
  merchantWalletFundingConsentSchema,
} from './merchant-wallet-funding';

describe('merchant wallet funding consent', () => {
  it('accepts literal true only', () =>
    expect(merchantWalletFundingConsentSchema.parse({ consent: true })).toEqual(
      { consent: true }
    ));
  it.each([
    { consent: false },
    {},
    { consent: true, extra: 'x' },
  ])('rejects invalid payload %o', (payload) => {
    expect(merchantWalletFundingConsentSchema.safeParse(payload).success).toBe(
      false
    );
  });
});

describe('merchant shipping wallet balance', () => {
  it.each([
    [1250.5, 1250.5],
    ['1250.50', 1250.5],
    [0, 0],
    [null, 0],
  ])('parses %o as %o', (input, expected) => {
    expect(merchantShippingWalletBalanceSchema.parse(input)).toBe(expected);
  });
  it.each([
    undefined,
    '',
    'not-a-number',
    [{ available_balance: 1 }],
    { available_balance: 1 },
  ])('rejects %o', (input) => {
    expect(merchantShippingWalletBalanceSchema.safeParse(input).success).toBe(
      false
    );
  });
});

describe('merchant wallet funding account rows', () => {
  it('accepts the safe projection only', () => {
    const rows = [
      {
        account_name: 'Shop',
        account_number: '1234567890',
        bank_name: null,
        currency: 'NGN',
        status: 'active',
      },
    ];
    expect(merchantWalletFundingAccountRowsSchema.parse(rows)).toEqual(rows);
  });
  it('rejects disabled rows and other currencies', () => {
    const row = {
      account_name: null,
      account_number: '1234567890',
      bank_name: null,
      currency: 'NGN',
      status: 'disabled',
    };
    expect(
      merchantWalletFundingAccountRowsSchema.safeParse([row]).success
    ).toBe(false);
    expect(
      merchantWalletFundingAccountRowsSchema.safeParse([
        { ...row, status: 'active', currency: 'USD' },
      ]).success
    ).toBe(false);
  });
});
