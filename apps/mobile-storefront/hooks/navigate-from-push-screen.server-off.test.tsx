import { router } from 'expo-router';
import { navigateFromPushScreen } from './navigate-from-push-screen';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/wallet-funding-intent', () => ({
  clearWalletFundingIntent: jest.fn(),
  consumeWalletFundingIntent: jest.fn(),
}));
jest.mock('@/lib/resolve-active-customer-id', () => ({
  resolveActiveCustomerId: jest.fn(),
}));

// Routing only: a savings push never reaches PiggyVest from here.
describe('server keeps PiggyVest off: savings push taps', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends a named goal through the ownership-checking goal link', () => {
    navigateFromPushScreen('wallet', {
      action: 'savings',
      savingsGoalId: 'goal-1',
    });
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/wallet/savings/goal-actions',
      params: { goalId: 'goal-1' },
    });
  });

  it('opens the wallet savings sheet when no goal is named', () => {
    navigateFromPushScreen('wallet', { action: 'savings' });
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/wallet',
      params: { action: 'savings' },
    });
  });
});
