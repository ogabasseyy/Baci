import { jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { ExtractState } from 'zustand/vanilla';
import { BRAND } from '@/constants/Colors';
import type { UtilityRepeatRecipient } from '@/lib/utility-repeat';
import { ensureUtilityWalletReady } from '@/lib/utility-wallet-readiness';
import type { useAuthStore as useAuthStoreType } from '@/stores/auth-store';
import { AirtimeForm } from './AirtimeForm';

type AuthStoreState = ExtractState<typeof useAuthStoreType>;
type AuthStorePartial = Partial<AuthStoreState>;

const mockUseUtilityPayment = jest.fn();
const mockChargeWalletForVtu =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
// Exposed by the mocked keyboard hook so future interaction tests can assert dismissal.
const mockDismissKeyboard = jest.fn();
const mockKeyboardState = {
  isKeyboardVisible: false,
  keyboardHeight: 0,
};
const mockAuthStoreState = {
  customer: null,
  session: null,
  user: null,
} satisfies AuthStorePartial;

const recentRecipient: UtilityRepeatRecipient = {
  id: 'airtime-1',
  title: 'MTN',
  identifierLabel: 'Phone Number',
  identifier: '08012345678',
  meta: '₦1,000',
  defaults: {
    amount: '1000',
    isVerified: true,
    networkProvider: 'mtn',
    phoneNumber: '08012345678',
  },
};

function spyOnConsoleError() {
  return jest.spyOn(console, 'error').mockImplementation(() => undefined);
}

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/hooks/use-keyboard', () => ({
  useKeyboard: () => ({
    dismissKeyboard: mockDismissKeyboard,
    ...mockKeyboardState,
  }),
}));

jest.mock('@/hooks/use-utility-payment', () => ({
  useUtilityPayment: () => mockUseUtilityPayment(),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: <Selected,>(selector: (state: AuthStorePartial) => Selected) =>
    selector(mockAuthStoreState),
}));

jest.mock('@/lib/vtu-checkout', () => {
  const actual =
    jest.requireActual<typeof import('@/lib/vtu-checkout')>(
      '@/lib/vtu-checkout'
    );

  return {
    ...actual,
    chargeWalletForVtu: (...args: unknown[]) => mockChargeWalletForVtu(...args),
  };
});

jest.mock('@/lib/utility-wallet-readiness', () => ({
  ensureUtilityWalletReady: jest.fn(() => true),
}));

const mockEnsureUtilityWalletReady =
  ensureUtilityWalletReady as unknown as jest.Mock;

jest.mock('./UtilityPaymentOptions', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    UtilityPaymentOptions: () => <Text>Payment options</Text>,
  };
});

function fillValidAirtimeForm() {
  fireEvent.changeText(
    screen.getByPlaceholderText('08012345678'),
    '08031234567'
  );
  fireEvent.changeText(screen.getByPlaceholderText('1,000'), '1000');
}

describe('AirtimeForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockKeyboardState.isKeyboardVisible = false;
    mockKeyboardState.keyboardHeight = 0;
    mockUseUtilityPayment.mockReturnValue({
      canFundByBankTransfer: false,
      walletBalance: 5000,
      walletError: null,
      walletIsLoading: false,
      getWalletIdempotencyKey: jest.fn(() => 'test-key'),
      resetWalletIdempotencyKey: jest.fn(),
    });
    mockChargeWalletForVtu.mockResolvedValue({
      amount: 1000,
      reference: 'VTU-WALLET-123',
      status: 'successful',
    });
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps network provider cards hidden when phone number is empty', () => {
    render(<AirtimeForm onSuccess={jest.fn()} />);

    expect(screen.getByText('Phone Number')).toBeOnTheScreen();
    expect(screen.queryByText('Network')).toBeNull();
    expect(screen.queryByText('MTN')).toBeNull();
    expect(screen.queryByText('Airtel')).toBeNull();
  });

  it('auto-expands network options for unknown phone prefixes', () => {
    render(<AirtimeForm onSuccess={jest.fn()} />);

    fireEvent.changeText(
      screen.getByPlaceholderText('08012345678'),
      '08001234567'
    );

    expect(screen.getByText('MTN')).toBeOnTheScreen();
    expect(screen.getByText('Airtel')).toBeOnTheScreen();
  });

  it('renders recent recipients under the phone number field', async () => {
    const user = userEvent.setup();
    const onSelectRecentRecipient = jest.fn();

    render(
      <AirtimeForm
        onSuccess={jest.fn()}
        recentRecipients={[recentRecipient]}
        onSelectRecentRecipient={onSelectRecentRecipient}
      />
    );

    expect(screen.getByText('Select Beneficiary')).toBeOnTheScreen();
    expect(screen.getByText('Phone Number: 08012345678')).toBeOnTheScreen();

    await user.press(
      screen.getByLabelText('Select MTN, Phone Number 08012345678')
    );

    expect(onSelectRecentRecipient).toHaveBeenCalledWith(recentRecipient);
  });

  it('collapses to the detected network after phone entry', async () => {
    render(<AirtimeForm onSuccess={jest.fn()} />);

    fireEvent.changeText(
      screen.getByPlaceholderText('08012345678'),
      '08031234567'
    );

    await waitFor(() => expect(screen.getByText('MTN')).toBeOnTheScreen());
    expect(screen.getByText('Network')).toBeOnTheScreen();
    expect(screen.getByLabelText('MTN logo')).toBeOnTheScreen();
    expect(screen.queryByText('Airtel')).toBeNull();
  });

  it('clears the detected network when the phone number is erased', async () => {
    render(<AirtimeForm onSuccess={jest.fn()} />);

    fireEvent.changeText(
      screen.getByPlaceholderText('08012345678'),
      '08031234567'
    );
    await waitFor(() => expect(screen.getByText('Network')).toBeOnTheScreen());

    fireEvent.changeText(screen.getByPlaceholderText('08012345678'), '');

    expect(screen.queryByText('Network')).toBeNull();
    expect(screen.queryByText('MTN')).toBeNull();
  });

  it('clears a stale detected network and auto-expands options when phone edits become an unknown prefix', async () => {
    render(<AirtimeForm onSuccess={jest.fn()} />);

    fireEvent.changeText(
      screen.getByPlaceholderText('08012345678'),
      '08031234567'
    );
    await waitFor(() => expect(screen.getByText('Network')).toBeOnTheScreen());

    fireEvent.changeText(
      screen.getByPlaceholderText('08012345678'),
      '08001234567'
    );

    expect(screen.queryByText('Network')).toBeNull();
    expect(screen.getByText('MTN')).toBeOnTheScreen();
    expect(screen.getByText('Airtel')).toBeOnTheScreen();
  });

  it('expands network options from the selected network card', async () => {
    render(
      <AirtimeForm
        initialProvider="mtn"
        initialPhoneNumber="08031234567"
        onSuccess={jest.fn()}
      />
    );

    expect(screen.getByText('Network')).toBeOnTheScreen();
    expect(screen.queryByText('Airtel')).toBeNull();

    fireEvent.press(screen.getByLabelText('Change selected network'));

    await waitFor(() => {
      expect(screen.getByText('Airtel')).toBeOnTheScreen();
    });
  });

  it('highlights a quick amount when tapped', () => {
    render(<AirtimeForm onSuccess={jest.fn()} />);

    fireEvent.press(screen.getByText('₦1,000'));

    expect(screen.getByText('₦1,000')).toHaveStyle({
      color: BRAND.onPrimary,
    });
  });

  it('highlights the matching quick amount when typed manually', () => {
    render(<AirtimeForm onSuccess={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText('1,000'), '1000');

    expect(screen.getByText('₦1,000')).toHaveStyle({
      color: BRAND.onPrimary,
    });
  });

  it('hides the payment footer while the keyboard is visible', () => {
    mockKeyboardState.isKeyboardVisible = true;
    mockKeyboardState.keyboardHeight = 320;

    render(<AirtimeForm onSuccess={jest.fn()} />);

    expect(screen.queryByText(/Pay ₦/)).toBeNull();
  });

  it('completes a wallet airtime purchase', async () => {
    const onSuccessMock = jest.fn();
    render(<AirtimeForm onSuccess={onSuccessMock} />);

    fillValidAirtimeForm();
    fireEvent.press(screen.getByText('Pay ₦1,000'));

    await waitFor(() => {
      expect(mockChargeWalletForVtu).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1000,
          phoneNumber: '08031234567',
          type: 'airtime',
          walletAmount: 1000,
          idempotencyKey: 'test-key',
        })
      );
    });
    await waitFor(() => {
      expect(onSuccessMock).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: 'VTU-WALLET-123',
          status: 'successful',
        })
      );
    });
  });

  it('surfaces wallet airtime purchases that are still processing', async () => {
    const onSuccessMock = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      amount: 1000,
      reference: 'VTU-WALLET-PENDING-123',
      status: 'processing',
    });
    render(<AirtimeForm onSuccess={onSuccessMock} />);

    fillValidAirtimeForm();
    fireEvent.press(screen.getByText('Pay ₦1,000'));

    await waitFor(() => {
      expect(onSuccessMock).toHaveBeenCalledWith({
        amount: 1000,
        customerIdentifier: '08031234567',
        reference: 'VTU-WALLET-PENDING-123',
        status: 'processing',
      });
    });
    expect(Alert.alert).not.toHaveBeenCalledWith(
      'Payment Failed',
      expect.any(String)
    );
  });

  it('alerts and does not complete when the wallet charge rejects', async () => {
    const consoleErrorSpy = spyOnConsoleError();
    const onSuccessMock = jest.fn();
    mockChargeWalletForVtu.mockRejectedValueOnce(
      new Error('Wallet charge failed')
    );
    render(<AirtimeForm onSuccess={onSuccessMock} />);

    fillValidAirtimeForm();
    fireEvent.press(screen.getByText('Pay ₦1,000'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Payment Failed',
        'Wallet charge failed'
      );
    });
    expect(onSuccessMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Airtime purchase failed:',
      expect.any(Error)
    );
    await waitFor(() => {
      expect(screen.getByText('Pay ₦1,000')).toBeOnTheScreen();
    });
  });

  it('checks wallet readiness before charging and skips the charge when not ready', async () => {
    const onSuccessMock = jest.fn();
    mockEnsureUtilityWalletReady.mockReturnValueOnce(false);
    render(<AirtimeForm onSuccess={onSuccessMock} />);

    fillValidAirtimeForm();
    fireEvent.press(screen.getByText('Pay ₦1,000'));

    await waitFor(() => {
      expect(mockEnsureUtilityWalletReady).toHaveBeenCalledWith({
        amount: 1000,
        customer: null,
        payment: expect.objectContaining({ walletBalance: 5000 }),
        returnToHref: expect.any(String),
      });
    });
    expect(mockChargeWalletForVtu).not.toHaveBeenCalled();
    expect(onSuccessMock).not.toHaveBeenCalled();
  });
});
