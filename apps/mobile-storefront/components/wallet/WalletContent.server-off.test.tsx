import { fireEvent, render, screen } from '@testing-library/react-native';
import { deriveWalletDisplayData } from './derive-wallet-display-data';
import { WalletContent } from './WalletContent';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    __esModule: true,
    default: { View },
    FadeIn: { duration: () => ({ delay: () => ({}) }) },
  };
});
jest.mock('@/hooks/use-debounce', () => ({ useDebounce: (v: string) => v }));
jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({ isLoading: false, products: [] }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => false,
  isHostedStagingWalletTopUpBlocked: () => false,
}));

// Outside the staging preview the wallet is production's: the user's own
// funding account in the hero, the regular payment for savings, and none of
// the plan-funding notes.
describe('server keeps PiggyVest off', () => {
  it('shows the wallet funding account and the regular savings payment', () => {
    const props = createWalletContentProps();
    render(
      <WalletContent
        {...props}
        savingsContributionAmount="500"
        showSavingsProgress
      />
    );
    expect(screen.getByText('1234567890')).toBeOnTheScreen();
    expect(screen.queryByText('Add from your wallet')).toBeNull();
    expect(screen.queryByText(/still being set up/)).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Continue to payment' })
    );
    expect(props.onFundSavingsWallet).toHaveBeenCalledTimes(1);
  });

  it('shows the legacy balance and Paystack path when the primary balance is absent', () => {
    const props = createWalletContentProps();
    const display = deriveWalletDisplayData({
      balance: 5000,
      savings_balance: 0,
      total_balance: 5000,
    });
    render(
      <WalletContent
        {...props}
        primaryReady={display.primaryReady}
        savingsContributionAmount="500"
        showSavingsProgress
        spendableBalance={0}
        totalBalance={display.totalBalance}
      />
    );
    expect(screen.getByText('₦5,000')).toBeOnTheScreen();
    expect(screen.queryByText('Add money')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeOnTheScreen();
  });
});
