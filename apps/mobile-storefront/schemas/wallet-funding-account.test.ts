import { describe, expect, it } from '@jest/globals';
import {
  WalletFundingAccountResponseSchema,
  WalletFundingAccountSchema,
} from './wallet-funding-account';

describe('wallet funding account schemas', () => {
  it('parses a nullable account response', () => {
    expect(
      WalletFundingAccountResponseSchema.parse({
        account: null,
        requiresConsent: true,
      })
    ).toEqual({
      account: null,
      requiresConsent: true,
    });
  });

  it('rejects non-Paystack funding accounts', () => {
    expect(() =>
      WalletFundingAccountResponseSchema.parse({
        account: {
          accountName: 'Ogabassey/Jane Doe',
          accountNumber: '1234567890',
          bankName: 'Titan Paystack',
          provider: 'other',
        },
        requiresConsent: false,
      })
    ).toThrow();
  });

  it('trims valid funding account strings', () => {
    expect(
      WalletFundingAccountSchema.parse({
        accountName: ' Ogabassey/Jane Doe ',
        accountNumber: ' 1234567890 ',
        bankName: ' Titan Paystack ',
        provider: 'paystack',
      })
    ).toEqual({
      accountName: 'Ogabassey/Jane Doe',
      accountNumber: '1234567890',
      bankName: 'Titan Paystack',
      provider: 'paystack',
    });
  });

  it('validates account number length boundaries', () => {
    expect(
      WalletFundingAccountSchema.parse({
        accountName: 'Ogabassey/Jane Doe',
        accountNumber: '1'.repeat(10),
        bankName: 'Titan Paystack',
        provider: 'paystack',
      }).accountNumber
    ).toBe('1'.repeat(10));
    expect(
      WalletFundingAccountSchema.parse({
        accountName: 'Ogabassey/Jane Doe',
        accountNumber: '1'.repeat(20),
        bankName: 'Titan Paystack',
        provider: 'paystack',
      }).accountNumber
    ).toBe('1'.repeat(20));
    expect(() =>
      WalletFundingAccountSchema.parse({
        accountName: 'Ogabassey/Jane Doe',
        accountNumber: '1'.repeat(9),
        bankName: 'Titan Paystack',
        provider: 'paystack',
      })
    ).toThrow();
    expect(() =>
      WalletFundingAccountSchema.parse({
        accountName: 'Ogabassey/Jane Doe',
        accountNumber: '1'.repeat(21),
        bankName: 'Titan Paystack',
        provider: 'paystack',
      })
    ).toThrow();
  });

  it('rejects empty, too-long, and non-numeric account fields', () => {
    expect(() =>
      WalletFundingAccountSchema.parse({
        accountName: '   ',
        accountNumber: '1234567890',
        bankName: 'Titan Paystack',
        provider: 'paystack',
      })
    ).toThrow();
    expect(() =>
      WalletFundingAccountSchema.parse({
        accountName: 'Ogabassey/Jane Doe',
        accountNumber: '1234ABC890',
        bankName: 'Titan Paystack',
        provider: 'paystack',
      })
    ).toThrow();
    expect(() =>
      WalletFundingAccountSchema.parse({
        accountName: 'A'.repeat(201),
        accountNumber: '1234567890',
        bankName: 'Titan Paystack',
        provider: 'paystack',
      })
    ).toThrow();
  });

  it('accepts 200-char provider names in parity with the server snapshot schema', () => {
    // The server accepts account_name/bank_name up to 200 chars; the
    // client must parse the same so a legitimate funding account is
    // never rejected after the server returned it.
    const parsed = WalletFundingAccountSchema.parse({
      accountName: 'A'.repeat(200),
      accountNumber: '1234567890',
      bankName: 'B'.repeat(200),
      provider: 'piggyvest',
    });
    expect(parsed.accountName).toHaveLength(200);
    expect(parsed.bankName).toHaveLength(200);
    expect(() =>
      WalletFundingAccountSchema.parse({
        accountName: 'Ogabassey/Jane Doe',
        accountNumber: '1234567890',
        bankName: 'B'.repeat(201),
        provider: 'piggyvest',
      })
    ).toThrow();
  });
});
