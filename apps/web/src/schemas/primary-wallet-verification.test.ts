import { describe, expect, it } from 'vitest';
import { primaryWalletVerificationSchemas as schemas } from './primary-wallet-verification';

const proof = {
  mapping: { providerCustomerId: 'customer', providerWalletId: 'wallet' },
  wallet: {
    id: 'wallet',
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
    balance: 0,
  },
  accounts: [
    {
      account_number: '0123456789',
      account_name: 'Synthetic',
      bank_name: 'Bank',
    },
  ],
};

describe('primary wallet verification schemas', () => {
  it('accepts provider proof with zero balance and a valid funding channel', () => {
    expect(schemas.proof.parse(proof)).toEqual(proof);
  });
  it.each([
    { mapping: null },
    { accounts: [] },
    { accounts: Array(21).fill(proof.accounts[0]) },
    { accounts: [{ ...proof.accounts[0], account_number: '123' }] },
    { accounts: [{ ...proof.accounts[0], bank_name: '' }] },
    { wallet: { ...proof.wallet, currency: 'USD' } },
    { wallet: { ...proof.wallet, balance: -1 } },
    { wallet: { ...proof.wallet, balance: 0.5 } },
    { mapping: { ...proof.mapping, email: 'synthetic@example.test' } },
    { phone: '08000000000' },
  ])('rejects incomplete, malformed, or profile-selected proof %j', (change) => {
    expect(schemas.proof.safeParse({ ...proof, ...change }).success).toBe(
      false
    );
  });
  it('projects provider fields without carrying unexpected provider data', () => {
    const parsed = schemas.proof.parse({
      ...proof,
      wallet: { ...proof.wallet, provider_internal: 'fixture' },
    });
    expect(parsed.wallet).toEqual(proof.wallet);
  });
});
