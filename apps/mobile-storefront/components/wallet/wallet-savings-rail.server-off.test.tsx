import { planWalletSavingsRail } from './wallet-savings-rail';

// A merchant with PiggyVest off keeps the production legacy flow: a fresh id
// starts on legacy and a stored id is resubmitted on legacy, never blocked.
describe('server keeps PiggyVest off', () => {
  it('starts and retries on the legacy rail', () => {
    expect(
      planWalletSavingsRail({
        hasStoredId: false,
        isPrimary: false,
        storedRail: null,
      })
    ).toEqual({ kind: 'submit', rail: 'legacy' });
    expect(
      planWalletSavingsRail({
        hasStoredId: true,
        isPrimary: false,
        storedRail: 'legacy',
      })
    ).toEqual({ kind: 'submit', rail: 'legacy' });
  });
});
