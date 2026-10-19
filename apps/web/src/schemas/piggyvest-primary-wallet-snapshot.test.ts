import { describe, expect, it } from 'vitest';
import { piggyvestPrimaryWalletSnapshotSchemas as schemas } from './piggyvest-primary-wallet-snapshot';

describe('primary wallet snapshot schemas', () => {
  it('accepts an absent mapping and opaque provider identifiers', () => {
    expect(schemas.mapping.parse(null)).toBeNull();
    expect(
      schemas.mapping.safeParse({
        providerWalletId: 'opaque-wallet',
        providerCustomerId: 'opaque-customer',
      }).success
    ).toBe(true);
  });
  it('requires both mapped provider identifiers and disallows extra fields', () => {
    expect(
      schemas.mapping.safeParse({ providerWalletId: 'wallet' }).success
    ).toBe(false);
    expect(
      schemas.mapping.safeParse({
        providerWalletId: 'wallet',
        providerCustomerId: 'customer',
        bvn: '00000000000',
      }).success
    ).toBe(false);
  });
  it('retains leading zeros in valid bank account numbers', () => {
    expect(
      schemas.accounts.parse([
        {
          account_number: '0123456789',
          account_name: 'Test',
          bank_name: 'Bank',
        },
      ])[0].account_number
    ).toBe('0123456789');
  });
  it('rejects malformed bank numbers and unsafe monetary values', () => {
    expect(
      schemas.accounts.safeParse([
        { account_number: '123', account_name: 'Test', bank_name: 'Bank' },
      ]).success
    ).toBe(false);
    expect(
      schemas.wallet.safeParse({
        id: 'wallet',
        business_id: 'business',
        currency: 'NGN',
        status: 'active',
        balance: Number.MAX_SAFE_INTEGER + 1,
      }).success
    ).toBe(false);
  });
});
