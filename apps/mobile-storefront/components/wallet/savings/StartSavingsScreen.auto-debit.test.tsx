import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { StartSavingsScreen } from './StartSavingsScreen';

const mockRouterPush = jest.fn();
const mockUseProducts = jest.fn();
const mockInitializeSavingsAuthorization =
  jest.fn<
    (input: unknown) => Promise<{
      authorization_url: string;
      checkout_url: string;
      gateway: 'paystack';
      reference: string;
      success: true;
    }>
  >();
const mockListCustomerPaymentMethods = jest.fn<() => Promise<unknown[]>>();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    replace: jest.fn(),
  },
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
        funding_account: null,
      },
    },
    isRefetching: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('@/lib/customer-savings', () => ({
  createSavingsGoal: jest.fn(),
  initializeSavingsAuthorization: (input: unknown) =>
    mockInitializeSavingsAuthorization(input),
  listCustomerPaymentMethods: () => mockListCustomerPaymentMethods(),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { merchantId: string | null }) => unknown) =>
    selector({ merchantId: 'merchant-1' }),
}));

function getSavingsButton(name: string) {
  return screen.getByRole('button', { name });
}

function getSavingsRadio(name: string) {
  return screen.getByRole('radio', { name });
}

function getSavingsInput(name: string) {
  return screen.getByLabelText(name);
}

function fillAutoDebitForm() {
  fireEvent.changeText(
    screen.getByRole('search', { name: 'Savings product search' }),
    'iPhone'
  );
  fireEvent.press(getSavingsButton('Select iPhone 13 Pro Max'));
  fireEvent.changeText(getSavingsInput('Savings contribution amount'), '20000');
  fireEvent.press(getSavingsRadio('Use auto debit for savings'));
  fireEvent.press(
    screen.getByRole('checkbox', {
      name: 'Accept non-withdrawable savings terms',
    })
  );
  fireEvent.press(getSavingsButton('Continue savings setup'));
  fireEvent.press(getSavingsButton('Choose savings funding option'));
}

describe('StartSavingsScreen auto-debit authorization', () => {
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
    mockListCustomerPaymentMethods.mockResolvedValue([]);
    mockInitializeSavingsAuthorization.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/savings-auth',
      checkout_url: 'https://checkout.paystack.com/savings-auth',
      gateway: 'paystack',
      reference: 'SAV-AUTH-123',
      success: true,
    });
  });

  it('routes auto-debit users to Paystack authorization when no card is saved', async () => {
    render(<StartSavingsScreen />);

    fillAutoDebitForm();

    await waitFor(() =>
      expect(screen.getByText('No saved cards yet.')).toBeOnTheScreen()
    );
    fireEvent.press(getSavingsButton('Add savings card'));

    await waitFor(() =>
      expect(mockInitializeSavingsAuthorization).toHaveBeenCalledTimes(1)
    );
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/payment-gateway',
      params: expect.objectContaining({
        authorizationUrl: 'https://checkout.paystack.com/savings-auth',
        gateway: 'paystack',
        merchantId: 'merchant-1',
        paymentKind: 'savings_auth',
        reference: 'SAV-AUTH-123',
        returnTo: '/wallet/savings/start',
      }),
    });
  });

  it('alerts and stays on the screen when card authorization fails', async () => {
    mockInitializeSavingsAuthorization.mockRejectedValueOnce(
      new Error('Authorization failed')
    );
    render(<StartSavingsScreen />);

    fillAutoDebitForm();

    await waitFor(() =>
      expect(screen.getByText('No saved cards yet.')).toBeOnTheScreen()
    );
    fireEvent.press(getSavingsButton('Add savings card'));

    await waitFor(() =>
      expect(mockInitializeSavingsAuthorization).toHaveBeenCalledTimes(1)
    );
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Unable to add card',
      'Authorization failed'
    );
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
