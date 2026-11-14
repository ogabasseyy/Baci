import { getEffectiveInitialContribution } from './start-savings.helpers';

describe('start savings helpers with PiggyVest off', () => {
  it('takes the head start only when it is turned on', () => {
    expect(
      getEffectiveInitialContribution({
        contributionAmount: 2000,
        fundingOption: 'bank_transfer',
        initialContributionAmount: 5000,
        initialContributionEnabled: false,
      })
    ).toBe(0);
    expect(
      getEffectiveInitialContribution({
        contributionAmount: 2000,
        fundingOption: 'wallet',
        initialContributionAmount: 5000,
        initialContributionEnabled: true,
      })
    ).toBe(5000);
  });
});
