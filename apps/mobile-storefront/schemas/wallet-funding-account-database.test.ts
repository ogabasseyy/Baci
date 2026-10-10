import { walletFundingAccountDatabaseSchema } from './wallet-funding-account-database';

describe('database funding account schema', () => {
  const account = {
    account_name: 'Test',
    account_number: '1234567890',
    bank_name: 'Wema Bank',
    provider: 'paystack',
  };
  it('accepts a complete legacy account', () => {
    expect(walletFundingAccountDatabaseSchema.safeParse(account).success).toBe(
      true
    );
  });
  it.each([
    { ...account, account_name: '' },
    { ...account, account_number: 'invalid' },
    { ...account, bank_name: '' },
    { ...account, provider: 'unverified' },
  ])('rejects invalid account fields', (data) => {
    expect(walletFundingAccountDatabaseSchema.safeParse(data).success).toBe(
      false
    );
  });
});
