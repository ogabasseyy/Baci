import { expect, it } from 'vitest';
import { piggyvestFundingDisplaySchema } from './piggyvest-funding-display';

it('accepts pending and unavailable without stale details', () => {
  for (const status of ['pending', 'unavailable']) {
    expect(piggyvestFundingDisplaySchema.safeParse({ status }).success).toBe(
      true
    );
    expect(
      piggyvestFundingDisplaySchema.safeParse({ status, accounts: [] }).success
    ).toBe(false);
  }
});
it('rejects extra provider fields and invalid account data', () => {
  const account = {
    accountNumber: '000000001',
    accountName: 'Synthetic',
    bankName: 'Synthetic Bank',
  };
  expect(
    piggyvestFundingDisplaySchema.safeParse({
      status: 'ready',
      accounts: [account],
    }).success
  ).toBe(true);
  for (const invalid of [
    { ...account, accountNumber: '' },
    { ...account, providerWalletId: 'private' },
    { ...account, accountName: '\ud800' },
    { ...account, bankName: 'bad\nname' },
    { ...account, accountNumber: 'a'.repeat(65) },
  ]) {
    expect(
      piggyvestFundingDisplaySchema.safeParse({
        status: 'ready',
        accounts: [invalid],
      }).success
    ).toBe(false);
  }
});

it('accepts well-formed Unicode without native isWellFormed or TextEncoder', () => {
  expect(
    piggyvestFundingDisplaySchema.safeParse({
      status: 'ready',
      accounts: [
        {
          accountNumber: '000000001',
          accountName: 'Synthetic 😀',
          bankName: 'Bánk',
        },
      ],
    }).success
  ).toBe(true);
});
