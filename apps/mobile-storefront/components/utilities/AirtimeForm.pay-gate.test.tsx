import { jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AirtimeForm } from './AirtimeForm';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

const mockUseUtilityPayment = jest.fn();
const mockChargeWalletForVtu =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();

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
  useUtilityPayment: () => mockUseUtilityPayment(),
}));
jest.mock('@/stores/auth-store', () => {
  const state = { customer: null, session: null, user: null };
  const useAuthStore = Object.assign(
    <Selected,>(selector: (s: typeof state) => Selected) => selector(state),
    { getState: () => ({ user: null }) }
  );
  return { useAuthStore };
});
jest.mock('@/lib/vtu-checkout', () => ({
  ...jest.requireActual<typeof import('@/lib/vtu-checkout')>(
    '@/lib/vtu-checkout'
  ),
  chargeWalletForVtu: (...args: unknown[]) => mockChargeWalletForVtu(...args),
}));
jest.mock('./UtilityPaymentOptions', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return { UtilityPaymentOptions: () => <Text>Payment options</Text> };
});

function storeCreditWallet(balance: number, overrides = {}) {
  return {
    canFundByBankTransfer: false,
    getWalletBalance: () => balance,
    getWalletIdempotencyKey: jest.fn(async () => 'test-key'),
    hasRetainedVtuAttempt: jest.fn(() => false),
    isAuthenticated: true,
    isWalletSettled: () => true,
    walletError: null,
    walletIsLoading: false,
    walletIsStoreCredit: true,
    walletPrimaryUnknown: false,
    ...overrides,
  };
}

function enterPhone(value: string) {
  fireEvent.changeText(screen.getByPlaceholderText('08012345678'), value);
}

describe('AirtimeForm Pay gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    useVtuWalletPayStore.setState({
      covers: () => false,
      retains: async () => false,
    });
    mockUseUtilityPayment.mockReturnValue(storeCreditWallet(0));
  });

  describe('bugfix: Pay stayed red and enabled with ₦0 store credit', () => {
    it('disables Pay ₦100 and says why when store credit is ₦0', async () => {
      render(<AirtimeForm onSuccess={jest.fn()} />);
      enterPhone('08031234567');
      fireEvent.press(screen.getByRole('button', { name: '₦100' }));

      // Disabled once the kept-attempt lookup answers "none kept".
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Pay ₦100' })).toBeDisabled()
      );
      const pay = screen.getByRole('button', { name: 'Pay ₦100' });
      expect(pay.props.accessibilityState).toMatchObject({ disabled: true });
      expect(
        screen.getByText('Not enough store credit to pay this.')
      ).toBeOnTheScreen();
      expect(
        screen.getByRole('button', { name: 'Add store credit' })
      ).toBeOnTheScreen();
      fireEvent.press(pay);
      expect(mockChargeWalletForVtu).not.toHaveBeenCalled();
    });

    it('enables Pay once store credit covers the amount', () => {
      mockUseUtilityPayment.mockReturnValue(storeCreditWallet(500));
      render(<AirtimeForm onSuccess={jest.fn()} />);
      enterPhone('08031234567');
      fireEvent.press(screen.getByRole('button', { name: '₦100' }));

      expect(screen.getByRole('button', { name: 'Pay ₦100' })).toBeEnabled();
      expect(screen.queryByText(/Not enough store credit/)).toBeNull();
    });

    it('keeps Pay enabled for a kept attempt, which replays without a new charge', () => {
      mockUseUtilityPayment.mockReturnValue(
        storeCreditWallet(0, { hasRetainedVtuAttempt: jest.fn(() => true) })
      );
      render(<AirtimeForm onSuccess={jest.fn()} />);
      enterPhone('08031234567');
      fireEvent.press(screen.getByRole('button', { name: '₦100' }));

      expect(screen.getByRole('button', { name: 'Pay ₦100' })).toBeEnabled();
    });

    it('keeps Pay enabled while the balance is still loading', () => {
      mockUseUtilityPayment.mockReturnValue(
        storeCreditWallet(0, { walletIsLoading: true })
      );
      render(<AirtimeForm onSuccess={jest.fn()} />);
      enterPhone('08031234567');
      fireEvent.press(screen.getByRole('button', { name: '₦100' }));

      expect(screen.getByRole('button', { name: 'Pay ₦100' })).toBeEnabled();
    });
  });

  it('keeps Pay enabled while the PiggyVest kept-attempt lookup is unanswered', () => {
    useVtuWalletPayStore.setState({ retains: () => new Promise(() => {}) });
    render(<AirtimeForm onSuccess={jest.fn()} />);
    enterPhone('08031234567');
    fireEvent.press(screen.getByRole('button', { name: '₦100' }));

    expect(screen.getByRole('button', { name: 'Pay ₦100' })).toBeEnabled();
  });

  describe('bugfix: tapping Pay with no phone number showed a system alert', () => {
    it('disables Pay and asks for the phone number in the page instead', () => {
      mockUseUtilityPayment.mockReturnValue(storeCreditWallet(5000));
      render(<AirtimeForm onSuccess={jest.fn()} />);
      fireEvent.press(screen.getByRole('button', { name: '₦100' }));

      const pay = screen.getByRole('button', { name: 'Pay ₦100' });
      expect(pay).toBeDisabled();
      expect(
        screen.getByText('Enter the phone number to top up.')
      ).toBeOnTheScreen();
      fireEvent.press(pay);
      expect(Alert.alert).not.toHaveBeenCalled();
    });
  });

  it('flags a full-length number that is not local beside the phone field', () => {
    mockUseUtilityPayment.mockReturnValue(storeCreditWallet(5000));
    render(<AirtimeForm onSuccess={jest.fn()} />);
    enterPhone('12345678901');
    fireEvent.press(screen.getByRole('button', { name: '₦100' }));

    expect(
      screen.getByText('Enter an 11-digit phone number, like 08012345678.')
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Pay ₦100' })).toBeDisabled();
  });

  it('flags an amount below ₦50 beside the amount field', () => {
    mockUseUtilityPayment.mockReturnValue(storeCreditWallet(5000));
    render(<AirtimeForm onSuccess={jest.fn()} />);
    enterPhone('08031234567');
    fireEvent.changeText(screen.getByPlaceholderText('1,000'), '20');

    expect(
      screen.getByText('Amount must be between ₦50 and ₦50,000.')
    ).toBeOnTheScreen();
    // The field may be scrolled away: the footer still says where to look.
    expect(screen.getByText('Check the amount above.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Pay ₦20' })).toBeDisabled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
