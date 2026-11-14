import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

// Capture the latest usePreventRemove(preventRemove, callback) args so the
// back-swipe intercept can be asserted and fired without a nav container.
const mockPreventRemoveState: {
  prevent: boolean;
  callback: (() => void) | null;
} = { prevent: false, callback: null };

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
const mockWalletRefetch = jest.fn();
let mockWalletBalance = 0;
let mockPrimaryBalanceKobo: number | undefined;
let mockWalletIsError = false;
let mockWalletIsLoading = false;

beforeEach(async () => {
  jest.clearAllMocks();
  alertSpy.mockClear();
  mockWalletBalance = 0;
  mockPrimaryBalanceKobo = undefined;
  mockWalletIsError = false;
  mockWalletIsLoading = false;
  mockWalletRefetch.mockClear();
  global.fetch = jest.fn() as typeof fetch;
  mockPreventRemoveState.prevent = false;
  mockPreventRemoveState.callback = null;
  await AsyncStorage.clear();
});

jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (prevent: boolean, callback: () => void) => {
    mockPreventRemoveState.prevent = prevent;
    mockPreventRemoveState.callback = callback;
  },
}));

jest.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '11111111-1111-4111-8111-111111111111'),
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  Stack: {
    Screen: () => null,
  },
}));

jest.mock('expo-image', () => ({
  Image: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/components/ui/AppKeyboardContainer', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => children,
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn() }),
}));

jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    data: {
      wallet: {
        balance: mockWalletBalance,
        ...(mockPrimaryBalanceKobo === undefined
          ? {}
          : { primary_balance_kobo: mockPrimaryBalanceKobo }),
      },
    },
    isError: mockWalletIsError,
    isLoading: mockWalletIsLoading,
    refetch: mockWalletRefetch,
  }),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      customer: { id: 'customer-1' },
      merchantId: 'merchant-1',
      session: { access_token: 'token-123' },
    }),
}));

import ImeiCheckerScreen from '@/app/imei-check';

// merchant-1 stands in for the Ogabassey pilot: owner decision 2026-11-13,
// PiggyVest (and its unknown-verdict holds) is only for that merchant.
jest.mock('@/lib/is-piggyvest-primary-merchant', () => {
  const actual = jest.requireActual<
    typeof import('@/lib/is-piggyvest-primary-merchant')
  >('@/lib/is-piggyvest-primary-merchant');
  return {
    isPiggyvestPrimaryMerchant: (id?: string | null) =>
      id === 'merchant-1' || actual.isPiggyvestPrimaryMerchant(id),
  };
});

describe('IMEI screen with the server keeping PiggyVest off', () => {
  it('shows the wallet balance and wallet top-up as today', () => {
    render(<ImeiCheckerScreen />);

    expect(screen.getByLabelText('Wallet balance ₦0')).toBeOnTheScreen();
    expect(screen.queryByText(/store credit/i)).toBeNull();

    fireEvent.press(screen.getByText('Top up to unlock'));
    expect(router.push).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/wallet\?action=fund&requiredAmount=\d+&returnTo=%2Fimei-check$/
      )
    );
  });
});

describe('bugfix: ₦5,000 PiggyVest customer told they can pay for a check', () => {
  it('shows ₦0 store credit and opens the store credit top-up', () => {
    // Arrange: ₦5,000 at PiggyVest, ₦0 in the older wallet (store credit).
    mockPrimaryBalanceKobo = 500_000;
    mockWalletBalance = 0;

    render(<ImeiCheckerScreen />);

    // Assert: the check is paid from store credit only.
    expect(screen.getByLabelText('Store credit ₦0')).toBeOnTheScreen();
    expect(screen.queryByText(/₦5,000/)).toBeNull();

    // Act: the top-up returns here, so the wallet opens "Add store credit".
    fireEvent.press(screen.getByText('Add store credit'));
    expect(router.push).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/wallet\?action=fund&requiredAmount=\d+&returnTo=%2Fimei-check$/
      )
    );
  });
});
