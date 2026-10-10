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
import type { UtilityRepeatRecipient } from '@/lib/utility-repeat';
import { ensureUtilityWalletReady } from '@/lib/utility-wallet-readiness';
import type { useAuthStore as useAuthStoreType } from '@/stores/auth-store';
import { DataForm } from './DataForm';

type AuthStoreState = ExtractState<typeof useAuthStoreType>;
type AuthStorePartial = Partial<AuthStoreState>;

const mockUseVTUBillers = jest.fn();
const mockChargeWalletForVtu =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockUseUtilityPayment = jest.fn();
const mockAuthStoreState = {
  customer: null,
  session: null,
  user: null,
} satisfies AuthStorePartial;

const recentRecipient: UtilityRepeatRecipient = {
  id: 'data-1',
  title: 'MTN',
  identifierLabel: 'Phone Number',
  identifier: '08012345678',
  meta: '₦1,000',
  defaults: {
    amount: '1000',
    dataPlanCode: 'mtn-1gb',
    isVerified: true,
    networkProvider: 'mtn',
    phoneNumber: '08012345678',
  },
};

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

jest.mock('@/hooks/use-vtu-billers', () => ({
  useVTUBillers: (...args: unknown[]) => mockUseVTUBillers(...args),
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

describe('DataForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseVTUBillers.mockReturnValue({
      data: [
        {
          billerId: 'mtn-1gb',
          billerName: 'MTN 1GB Data',
          billerType: 'Internet Data',
          categoryId: 'data',
          categoryName: 'Internet Data',
        },
        {
          billerId: 'airtel-1gb',
          billerName: 'Airtel 1GB Data',
          billerType: 'Internet Data',
          categoryId: 'data',
          categoryName: 'Internet Data',
        },
      ],
      error: null,
      isError: false,
      isLoading: false,
    });
    mockChargeWalletForVtu.mockResolvedValue({
      amount: 1000,
      reference: 'VTU-WALLET-123',
      status: 'successful',
    });
    mockUseUtilityPayment.mockReturnValue({
      canFundByBankTransfer: false,
      walletBalance: 5000,
      walletError: null,
      walletIsLoading: false,
      getWalletIdempotencyKey: jest.fn(() => 'test-key'),
      resetWalletIdempotencyKey: jest.fn(),
    });
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the biller picker pattern and collapses the selected data bundle', () => {
    const onSuccessMock = jest.fn();
    render(<DataForm onSuccess={onSuccessMock} />);

    fireEvent.changeText(screen.getByLabelText('Phone Number'), '08000000000');

    expect(screen.getByText('Phone Number')).toBeOnTheScreen();
    expect(screen.queryByText('Select Provider')).toBeNull();
    expect(screen.getByText('Select Data Bundle')).toBeOnTheScreen();
    expect(screen.getByText('MTN 1GB Data')).toBeOnTheScreen();
    expect(screen.getByText('Airtel 1GB Data')).toBeOnTheScreen();

    fireEvent.press(screen.getByText('MTN 1GB Data'));

    expect(screen.getByText('Data Bundle')).toBeOnTheScreen();
    expect(screen.getByText('MTN 1GB Data')).toBeOnTheScreen();
    expect(screen.queryByText('Airtel 1GB Data')).toBeNull();
    expect(screen.getByLabelText('Change selected provider')).toBeOnTheScreen();
  });

  it('renders recent recipients under the phone number field', async () => {
    const user = userEvent.setup();
    const onSelectRecentRecipient = jest.fn();

    render(
      <DataForm
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

  it('shows validation feedback when required data purchase fields are missing', () => {
    render(<DataForm onSuccess={jest.fn()} />);

    fireEvent.press(screen.getByText('Pay ₦0'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Missing Information',
      'Please enter a phone number and choose a data bundle.'
    );
  });

  it('shows loading state from the biller fetch', () => {
    mockUseVTUBillers.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isLoading: true,
    });
    render(<DataForm onSuccess={jest.fn()} />);

    fireEvent.changeText(screen.getByLabelText('Phone Number'), '08031234567');

    expect(screen.getByText('Loading providers…')).toBeOnTheScreen();
    expect(screen.queryByText('MTN 1GB Data')).toBeNull();
  });

  it('shows empty data bundle state from the biller fetch', () => {
    mockUseVTUBillers.mockReturnValue({
      data: [],
      error: null,
      isError: false,
      isLoading: false,
    });
    render(<DataForm onSuccess={jest.fn()} />);

    fireEvent.changeText(screen.getByLabelText('Phone Number'), '08031234567');

    expect(screen.getByText('No data bundles available')).toBeOnTheScreen();
  });

  it('shows error state from the biller fetch', () => {
    mockUseVTUBillers.mockReturnValue({
      data: undefined,
      error: new Error('Could not load data bundles.'),
      isError: true,
      isLoading: false,
    });
    render(<DataForm onSuccess={jest.fn()} />);

    fireEvent.changeText(screen.getByLabelText('Phone Number'), '08031234567');

    expect(screen.getByText('Could not load data bundles.')).toBeOnTheScreen();
    expect(screen.queryByText('No data bundles available')).toBeNull();
  });

  it('submits selected data bundle details to wallet checkout', async () => {
    const onSuccessMock = jest.fn();
    render(<DataForm onSuccess={onSuccessMock} />);

    fireEvent.changeText(screen.getByLabelText('Phone Number'), '08031234567');
    fireEvent.press(screen.getByText('MTN 1GB Data'));
    fireEvent.changeText(screen.getByLabelText('Amount'), '1000');
    fireEvent.press(screen.getByText('Pay ₦1,000'));

    await waitFor(() => {
      expect(mockChargeWalletForVtu).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1000,
          dataPlanCode: 'mtn-1gb',
          networkProvider: 'mtn',
          phoneNumber: '08031234567',
          type: 'data',
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

  it('requires selecting a nested Kuda data package and submits that package item code', async () => {
    mockUseVTUBillers.mockReturnValue({
      data: [
        {
          billerId: '2082751a-89c7-4862-86c5-5498194b32f3',
          billerName: 'MTN',
          billerType: 'Internet Data',
          categoryId: 'data',
          categoryName: 'Internet Data',
          billItems: [
            {
              amount: 1000,
              isAmountFixed: true,
              itemCode: 'MTN-1GB-MONTHLY',
              itemCurrencySymbol: 'NGN',
              itemFee: 0,
              itemName: 'MTN 1GB Monthly',
            },
            {
              amount: 3500,
              isAmountFixed: true,
              itemCode: 'MTN-35GB-MONTHLY',
              itemCurrencySymbol: 'NGN',
              itemFee: 0,
              itemName: 'MTN 3.5GB Monthly',
            },
          ],
        },
      ],
      error: null,
      isError: false,
      isLoading: false,
    });
    render(<DataForm onSuccess={jest.fn()} />);

    fireEvent.changeText(screen.getByLabelText('Phone Number'), '08031234567');
    fireEvent.press(screen.getByText('MTN'));
    fireEvent.press(screen.getByText('Pay ₦0'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Missing Information',
      'Please enter a phone number and choose a data bundle.'
    );

    fireEvent.press(screen.getByLabelText('MTN 3.5GB Monthly - ₦3,500'));
    fireEvent.press(screen.getByText('Pay ₦3,500'));

    await waitFor(() => {
      expect(mockChargeWalletForVtu).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 3500,
          dataPlanCode: 'MTN-35GB-MONTHLY',
          networkProvider: 'mtn',
          phoneNumber: '08031234567',
          type: 'data',
          walletAmount: 3500,
        })
      );
    });
  });

  it('syncs repeat-prefilled nested fixed data package amounts from current biller data', async () => {
    mockUseVTUBillers.mockReturnValue({
      data: [
        {
          billerId: '2082751a-89c7-4862-86c5-5498194b32f3',
          billerName: 'MTN',
          billerType: 'Internet Data',
          categoryId: 'data',
          categoryName: 'Internet Data',
          billItems: [
            {
              amount: 3500,
              isAmountFixed: true,
              itemCode: 'MTN-35GB-MONTHLY',
              itemCurrencySymbol: 'NGN',
              itemFee: 0,
              itemName: 'MTN 3.5GB Monthly',
            },
          ],
        },
      ],
      error: null,
      isError: false,
      isLoading: false,
    });
    render(
      <DataForm
        initialAmount="1000"
        initialPhoneNumber="08031234567"
        initialPlan="MTN-35GB-MONTHLY"
        onSuccess={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Amount').props.value).toBe('3,500');
    });

    fireEvent.press(screen.getByText('Pay ₦3,500'));

    await waitFor(() => {
      expect(mockChargeWalletForVtu).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 3500,
          dataPlanCode: 'MTN-35GB-MONTHLY',
          networkProvider: 'mtn',
          phoneNumber: '08031234567',
          type: 'data',
          walletAmount: 3500,
        })
      );
    });
  });

  it('resets stale fixed amounts when switching to a variable-price data package', () => {
    mockUseVTUBillers.mockReturnValue({
      data: [
        {
          billerId: '2082751a-89c7-4862-86c5-5498194b32f3',
          billerName: 'MTN',
          billerType: 'Internet Data',
          categoryId: 'data',
          categoryName: 'Internet Data',
          billItems: [
            {
              amount: 3500,
              isAmountFixed: true,
              itemCode: 'MTN-35GB-MONTHLY',
              itemCurrencySymbol: 'NGN',
              itemFee: 0,
              itemName: 'MTN 3.5GB Monthly',
            },
            {
              amount: 0,
              isAmountFixed: false,
              itemCode: 'MTN-FLEX',
              itemCurrencySymbol: 'NGN',
              itemFee: 0,
              itemName: 'MTN Flex',
            },
          ],
        },
      ],
      error: null,
      isError: false,
      isLoading: false,
    });
    render(<DataForm onSuccess={jest.fn()} />);

    fireEvent.changeText(screen.getByLabelText('Phone Number'), '08031234567');
    fireEvent.press(screen.getByText('MTN'));
    fireEvent.press(screen.getByLabelText('MTN 3.5GB Monthly - ₦3,500'));
    expect(screen.getByLabelText('Amount').props.value).toBe('3,500');

    fireEvent.press(screen.getByLabelText('MTN Flex'));

    expect(screen.getByLabelText('Amount').props.value).toBe('0');
  });

  it('calls onSuccess after a wallet data purchase succeeds', async () => {
    const onSuccessMock = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      amount: 1000,
      cashback: { amount: 5, credited: true, newBalance: 25 },
      reference: 'VTU-WALLET-123',
      status: 'successful',
      voucherPin: 'token-123',
    });
    render(<DataForm onSuccess={onSuccessMock} />);

    fireEvent.changeText(screen.getByLabelText('Phone Number'), '08031234567');
    fireEvent.press(screen.getByText('MTN 1GB Data'));
    fireEvent.changeText(screen.getByLabelText('Amount'), '1000');
    fireEvent.press(screen.getByText('Pay ₦1,000'));

    await waitFor(() => {
      expect(mockChargeWalletForVtu).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1000,
          dataPlanCode: 'mtn-1gb',
          networkProvider: 'mtn',
          phoneNumber: '08031234567',
          type: 'data',
        })
      );
      expect(onSuccessMock).toHaveBeenCalledWith({
        amount: 1000,
        cashback: { amount: 5, newBalance: 25 },
        reference: 'VTU-WALLET-123',
        status: 'successful',
        voucherPin: 'token-123',
      });
    });
  });

  it('checks wallet readiness before charging and skips the charge when not ready', async () => {
    const onSuccessMock = jest.fn();
    mockEnsureUtilityWalletReady.mockReturnValueOnce(false);
    render(<DataForm onSuccess={onSuccessMock} />);

    fireEvent.changeText(screen.getByLabelText('Phone Number'), '08031234567');
    fireEvent.press(screen.getByText('MTN 1GB Data'));
    fireEvent.changeText(screen.getByLabelText('Amount'), '1000');
    fireEvent.press(screen.getByText('Pay ₦1,000'));

    await waitFor(() => {
      expect(mockEnsureUtilityWalletReady).toHaveBeenCalledWith({
        amount: 1000,
        payment: expect.objectContaining({ walletBalance: 5000 }),
        returnToHref: expect.any(String),
      });
    });
    expect(mockChargeWalletForVtu).not.toHaveBeenCalled();
    expect(onSuccessMock).not.toHaveBeenCalled();
  });

  it('surfaces wallet data purchases that are still processing', async () => {
    const onSuccessMock = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      amount: 1000,
      reference: 'VTU-DATA-PENDING-123',
      status: 'processing',
    });
    render(<DataForm onSuccess={onSuccessMock} />);

    fireEvent.changeText(screen.getByLabelText('Phone Number'), '08031234567');
    fireEvent.press(screen.getByText('MTN 1GB Data'));
    fireEvent.changeText(screen.getByLabelText('Amount'), '1000');
    fireEvent.press(screen.getByText('Pay ₦1,000'));

    await waitFor(() => {
      expect(onSuccessMock).toHaveBeenCalledWith({
        amount: 1000,
        cashback: undefined,
        reference: 'VTU-DATA-PENDING-123',
        status: 'processing',
        voucherPin: undefined,
      });
    });
    expect(Alert.alert).not.toHaveBeenCalledWith(
      'Payment Failed',
      expect.any(String)
    );
  });
});
