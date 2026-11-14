import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { setClipboardString } from '@/lib/clipboard';
import { deriveWalletDisplayData } from './derive-wallet-display-data';
import { WalletContent } from './WalletContent';
import { setWalletTestCustomer } from './wallet-auth.test-support';
import { createWalletContentProps } from './wallet-content.test-utils';

let restoreCustomer: () => void;
beforeEach(() => {
  restoreCustomer = setWalletTestCustomer();
});
afterEach(() => restoreCustomer());

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    __esModule: true,
    default: { View },
    FadeIn: {
      duration: () => ({
        delay: () => ({}),
      }),
    },
  };
});

jest.mock('@/lib/clipboard', () => ({
  setClipboardString: jest.fn(),
}));

jest.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));

jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({
    isLoading: false,
    products: [
      {
        condition: 'Used',
        id: 'product-swap',
        image: 'https://cdn.example.com/swap.jpg',
        name: 'iPhone 16 Pro',
        price: 150000,
        slug: 'iphone-16-pro',
      },
    ],
  }),
}));

jest.mock('expo-image', () => ({
  Image: () => null,
}));

// Default off (production state); individual tests flip it on to exercise the
// credit-check affordance.
const mockCheckingStateEnabled = false;

jest.mock('@/constants/wallet-funding', () => ({
  get WALLET_FUNDING_CHECKING_STATE_ENABLED() {
    return mockCheckingStateEnabled;
  },
  WALLET_FUNDING_POLLING: { INTERVAL_MS: 5000, TIMEOUT_MS: 120000 },
}));

// The plan's savings wallet reads as ready, so the amount entry shows.
jest.mock('@/lib/customer-savings', () => ({
  ...(jest.requireActual('@/lib/customer-savings') as object),
  fetchExistingSavingsPlanFunding: () =>
    Promise.resolve({ status: 'ready', accounts: [] }),
}));

const _mockSetClipboardString = jest.mocked(setClipboardString);

describe('WalletContent with PiggyVest', () => {
  describe('PiggyVest main wallet ready', () => {
    it('shows the PiggyVest balance in the hero instead of the legacy figure', () => {
      const display = deriveWalletDisplayData({
        balance: 5000,
        primary_balance_kobo: 123456,
        savings_balance: 0,
        total_balance: 5000,
      });
      render(
        <WalletContent
          {...createWalletContentProps()}
          primaryReady={display.primaryReady}
          savingsBalance={display.savingsBalance}
          walletBalance={display.walletBalance}
          totalBalance={display.totalBalance}
        />
      );

      expect(screen.getByText('₦1,234.56')).toBeOnTheScreen();
      expect(screen.queryByText('₦5,000')).toBeNull();
    });

    it('sends savings funding to Add money, never Continue to payment', async () => {
      const props = createWalletContentProps();
      render(
        <WalletContent
          {...props}
          primaryReady
          savingsContributionAmount="500"
          showSavingsProgress
          walletBalance={100}
        />
      );

      fireEvent.press(
        await screen.findByRole('button', { name: 'Add money to wallet' })
      );
      expect(screen.queryByText(/Continue to payment/)).toBeNull();
      expect(props.onFundSavingsWallet).toHaveBeenCalledTimes(1);
    });
  });
});
