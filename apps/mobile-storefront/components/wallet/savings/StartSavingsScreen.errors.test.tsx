import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { StartSavingsScreen } from './StartSavingsScreen';

const mockUseProducts = jest.fn();
const mockCreateSavingsGoal =
  jest.fn<(input: unknown) => Promise<{ goalId: string; success: boolean }>>();

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));

jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => mockUseProducts(),
}));

jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    data: {
      wallet: {
        balance: 200000,
        earnings_balance: 200000,
        funding_account: {
          account_number: '0123456789',
          bank_name: 'Titan Paystack',
          provider: 'paystack',
        },
      },
    },
    isRefetching: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('@/lib/customer-savings', () => ({
  createSavingsGoal: (input: unknown) => mockCreateSavingsGoal(input),
  initializeSavingsAuthorization: jest.fn(),
  listCustomerPaymentMethods: jest.fn(async () => []),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { merchantId: string | null }) => unknown) =>
    selector({ merchantId: 'merchant-1' }),
}));

function getSavingsButton(name: string) {
  return screen.getByRole('button', { name });
}

describe('StartSavingsScreen errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockUseProducts.mockReturnValue({
      isLoading: false,
      products: [
        {
          id: 'product-1',
          name: 'iPhone 13 Pro Max',
          price: 800000,
          slug: 'iphone-13-pro-max',
        },
      ],
    });
  });

  it('shows an alert when savings goal creation keeps failing', async () => {
    mockCreateSavingsGoal.mockRejectedValue(new Error('Database unavailable'));
    render(<StartSavingsScreen />);

    fireEvent.changeText(
      screen.getByRole('search', { name: 'Savings product search' }),
      'iPhone'
    );
    fireEvent.press(getSavingsButton('Select iPhone 13 Pro Max'));
    fireEvent.changeText(
      screen.getByLabelText('Savings contribution amount'),
      '20000'
    );
    fireEvent.press(
      screen.getByRole('checkbox', {
        name: 'Accept non-withdrawable savings terms',
      })
    );
    fireEvent.press(getSavingsButton('Continue savings setup'));
    fireEvent.press(getSavingsButton('Choose savings funding option'));
    fireEvent.press(getSavingsButton('Continue funding option'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Unable to create plan',
        'Database unavailable'
      );
    });
  });
});

jest.mock('react-native-keyboard-controller', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { ScrollView, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    KeyboardAvoidingView: View,
    KeyboardController: { isVisible: () => false, dismiss: async () => {} },
    KeyboardAwareScrollView: React.forwardRef(
      (
        props: import('react-native').ScrollViewProps,
        ref: import('react').Ref<import('react-native').ScrollView>
      ) => React.createElement(ScrollView, { ...props, ref })
    ),
  };
});
