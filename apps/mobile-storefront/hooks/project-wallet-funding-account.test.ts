import { projectWalletFundingAccount } from './project-wallet-funding-account';

describe('wallet funding provider projection', () => {
  const account = {
    account_name: 'Test',
    account_number: '1234567890',
    bank_name: 'Wema Bank',
    provider: 'paystack',
  };
  it('does not display a Paystack account on the PiggyVest primary wallet', () => {
    expect(
      projectWalletFundingAccount(
        account,
        '6b5cb8a4-5575-456c-b936-8cdfae30db74'
      )
    ).toBeNull();
  });
  it('preserves valid legacy accounts for other merchants', () => {
    expect(projectWalletFundingAccount(account, 'another-merchant')).toEqual(
      account
    );
  });
  it('rejects malformed account data', () => {
    expect(
      projectWalletFundingAccount({ provider: 'paystack' }, 'another-merchant')
    ).toBeNull();
  });
});
