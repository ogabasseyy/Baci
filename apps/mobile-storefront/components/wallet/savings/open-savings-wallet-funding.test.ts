import { router } from 'expo-router';
import { openSavingsWalletFunding } from './open-savings-wallet-funding';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'setup-intent' }));

it('opens account setup/funding and preserves the exact plan and amount on return', () => {
  openSavingsWalletFunding({
    goalId: 'goal&other=1',
    amount: 10000,
    requiredTopUpAmount: 10000,
  });

  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/wallet',
    params: {
      action: 'bank-transfer',
      intent: 'setup-intent',
      requiredAmount: '10000',
      returnTo:
        '/wallet?action=savings&savingsGoalId=goal%26other%3D1&savingsAmount=10000',
    },
  });
});
