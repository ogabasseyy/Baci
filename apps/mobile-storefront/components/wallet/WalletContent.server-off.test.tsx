import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useAuthStore } from '@/stores/auth-store';
import { SERVER_OFF_MERCHANT_ID } from '@/test-support/piggyvest-server-off.test-support';
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
  beforeEach(() => {
    act(() => {
      useAuthStore.setState({
        user: { id: 'server-off-customer' } as never,
        merchantId: SERVER_OFF_MERCHANT_ID,
      });
    });
  });

  afterEach(() => {
    act(() => useAuthStore.setState({ user: null, merchantId: null }));
  });

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
        walletBalance={0}
        totalBalance={display.totalBalance}
      />
    );
    expect(screen.getAllByText('₦5,000').length).toBeGreaterThan(0);
    expect(screen.queryByText('Add money')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeOnTheScreen();
  });

  it('keeps savings payment unavailable until the customer is signed in', () => {
    act(() => useAuthStore.setState({ user: null }));
    render(
      <WalletContent
        {...createWalletContentProps()}
        savingsContributionAmount="500"
        showSavingsProgress
      />
    );
    expect(screen.getByText('Sign in to add to savings')).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Continue to payment' })
    ).toBeNull();
  });
});
