import { jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AirtimeForm } from './AirtimeForm';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

const mockOptions = jest.fn();

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/hooks/use-keyboard', () => ({
  useKeyboard: () => ({
    dismissKeyboard: jest.fn(),
    isKeyboardVisible: false,
    keyboardHeight: 0,
  }),
}));
jest.mock('@/hooks/use-utility-payment', () => ({
  useUtilityPayment: () => ({
    canFundByBankTransfer: false,
    walletBalance: 5000,
    getWalletBalance: () => 5000,
    walletError: null,
    walletIsLoading: false,
    isWalletSettled: () => true,
    hasRetainedVtuAttempt: () => false,
  }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: object) => unknown) =>
    selector({ customer: null, session: null, user: null }),
}));
jest.mock('./UtilityPaymentOptions', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    UtilityPaymentOptions: (props: unknown) => {
      mockOptions(props);
      return <Text>Payment options</Text>;
    },
  };
});

// With the server keeping PiggyVest off (the host never sets a key store),
// the airtime form is the one shipped today: no kept PiggyVest attempt is
// ever reported, so the payment section shows store credit as before.
describe('AirtimeForm with the server keeping PiggyVest off', () => {
  it('reports no kept PiggyVest attempt for a filled purchase', async () => {
    useVtuWalletPayStore.setState({
      covers: () => false,
      balanceKobo: null,
      retains: async () => false,
      pending: null,
    });
    render(<AirtimeForm onSuccess={jest.fn()} />);
    fireEvent.changeText(
      screen.getByPlaceholderText('08012345678'),
      '08031234567'
    );
    fireEvent.changeText(screen.getByPlaceholderText('1,000'), '1000');
    await waitFor(() => expect(mockOptions).toHaveBeenCalled());
    const last = mockOptions.mock.calls.at(-1)?.[0] as {
      retainedPiggyvest?: boolean;
    };
    expect(last.retainedPiggyvest).toBe(false);
  });
});
