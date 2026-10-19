import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { StartSavingsScreen } from './StartSavingsScreen';
import {
  acceptSavingsTerms,
  getSavingsButton,
  getSavingsInput,
  getSavingsRadio,
  openFundingOptions,
  selectSavingsProduct,
  setContributionAmount,
} from './start-savings-screen.test-utils';

const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
const mockUseLocalSearchParams = jest.fn();
const mockUseProducts = jest.fn();
const mockRefetch = jest.fn<() => Promise<unknown>>();
const mockCreateSavingsGoal =
  jest.fn<(input: unknown) => Promise<{ goalId: string; success: boolean }>>();
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
const mockListCustomerPaymentMethods =
  jest.fn<
    () => Promise<
      Array<{
        bank: string | null;
        brand: string | null;
        exp_month: string | null;
        exp_year: string | null;
        id: string;
        is_default: boolean;
        label: string;
        last4: string | null;
        provider: 'paystack';
      }>
    >
  >();
const mockRandomUUID = jest.fn<() => string>();
const mockFetchSavingsPlanFunding =
  jest.fn<
    (input: unknown) => Promise<{
      status: string;
      accounts?: Array<{
        accountNumber: string;
        accountName: string;
        bankName: string;
      }>;
    }>
  >();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => mockRandomUUID(),
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
          account_name: 'Ogabassey/Ada',
          account_number: '0123456789',
          bank_name: 'Titan Paystack',
          provider: 'paystack',
        },
        loyalty_points: 2000,
      },
    },
    isRefetching: false,
    refetch: mockRefetch,
  }),
}));

jest.mock('@/lib/customer-savings', () => ({
  createSavingsGoal: (input: unknown) => mockCreateSavingsGoal(input),
  fetchSavingsPlanFunding: (input: unknown) =>
    mockFetchSavingsPlanFunding(input),
  initializeSavingsAuthorization: (input: unknown) =>
    mockInitializeSavingsAuthorization(input),
  listCustomerPaymentMethods: () => mockListCustomerPaymentMethods(),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { merchantId: string | null }) => unknown) =>
    selector({ merchantId: 'merchant-1' }),
}));

jest.mock('@/lib/clipboard', () => ({
  setClipboardString: jest.fn(async () => true),
}));

describe('StartSavingsScreen', () => {
  it('does not mount legacy data or payment hooks when staging is explicitly unavailable', () => {
    render(<StartSavingsScreen staging={null} />);
    expect(screen.getByText('Draft review is unavailable.')).toBeOnTheScreen();
    expect(mockUseProducts).not.toHaveBeenCalled();
    expect(mockListCustomerPaymentMethods).not.toHaveBeenCalled();
    expect(mockInitializeSavingsAuthorization).not.toHaveBeenCalled();
    expect(mockCreateSavingsGoal).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
    mockRefetch.mockResolvedValue(undefined);
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
    mockCreateSavingsGoal.mockResolvedValue({
      goalId: 'goal-1',
      success: true,
    });
    mockInitializeSavingsAuthorization.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/savings-auth',
      checkout_url: 'https://checkout.paystack.com/savings-auth',
      gateway: 'paystack',
      reference: 'SAV-AUTH-123',
      success: true,
    });
    mockListCustomerPaymentMethods.mockResolvedValue([
      {
        bank: 'Access Bank',
        brand: 'visa',
        exp_month: '08',
        exp_year: '2030',
        id: 'card-1',
        is_default: true,
        label: 'Access Bank ending 1234',
        last4: '1234',
        provider: 'paystack',
      },
    ]);
    mockRandomUUID.mockReturnValue('initial-contribution-key-1');
  });

  it('reveals valid steps and preserves entries when changing device', () => {
    const frame = jest
      .spyOn(global, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    render(<StartSavingsScreen />);
    expect(screen.queryByLabelText('Savings contribution amount')).toBeNull();
    expect(screen.queryByLabelText('Savings source of funds')).toBeNull();
    selectSavingsProduct();
    expect(
      screen.getByLabelText('Savings contribution amount')
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText('Savings source of funds')).toBeNull();
    setContributionAmount();
    expect(screen.getByLabelText('Savings source of funds')).toBeOnTheScreen();
    fireEvent.press(getSavingsRadio('Initial contribution Yes'));
    expect(screen.queryByLabelText('Savings source of funds')).toBeNull();
    fireEvent.changeText(
      getSavingsInput('Initial contribution amount'),
      '1000'
    );
    expect(screen.getByLabelText('Savings source of funds')).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText('Change savings device'));
    expect(screen.queryByLabelText('Savings contribution amount')).toBeNull();
    selectSavingsProduct();
    expect(
      screen.getByLabelText('Initial contribution amount').props.value
    ).toBe('1,000');
    expect(screen.getByLabelText('Savings source of funds')).toBeOnTheScreen();
    frame.mockRestore();
  });

  it('requires terms acceptance before opening preview', () => {
    render(<StartSavingsScreen />);

    selectSavingsProduct();
    expect(screen.queryByLabelText('Savings target amount')).toBeNull();
    setContributionAmount();
    fireEvent.press(getSavingsButton('Continue savings setup'));

    expect(
      screen.getByText('You must accept the non-withdrawable savings terms.')
    ).toBeOnTheScreen();
  });

  it('creates a manual savings goal via wallet balance', async () => {
    render(<StartSavingsScreen />);

    selectSavingsProduct();
    setContributionAmount();
    acceptSavingsTerms();
    fireEvent.press(getSavingsButton('Continue savings setup'));

    expect(screen.getByText('Your savings plan')).toBeOnTheScreen();

    fireEvent.press(getSavingsButton('Choose savings funding option'));
    fireEvent.press(getSavingsButton('Continue funding option'));

    await waitFor(() => expect(mockCreateSavingsGoal).toHaveBeenCalledTimes(1));
    expect(mockCreateSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        contributionAmount: 20000,
        contributionFrequency: 'daily',
        productId: 'product-1',
        sourceMode: 'manual',
        targetAmount: 800000,
      })
    );
    await waitFor(() =>
      expect(
        screen.getByText('Savings plan created successfully')
      ).toBeOnTheScreen()
    );
  });

  it('reuses the same initial contribution idempotency key across retries', async () => {
    mockCreateSavingsGoal
      .mockRejectedValueOnce(new Error('Temporary network error'))
      .mockResolvedValueOnce({ goalId: 'goal-1', success: true });
    render(<StartSavingsScreen />);

    selectSavingsProduct();
    setContributionAmount();
    fireEvent.press(getSavingsRadio('Initial contribution Yes'));
    fireEvent.changeText(
      getSavingsInput('Initial contribution amount'),
      '20000'
    );
    acceptSavingsTerms();
    openFundingOptions();
    fireEvent.press(getSavingsButton('Continue funding option'));

    await waitFor(() => expect(mockCreateSavingsGoal).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(getSavingsButton('Continue funding option')).not.toBeDisabled()
    );
    fireEvent.press(getSavingsButton('Continue funding option'));

    await waitFor(() => expect(mockCreateSavingsGoal).toHaveBeenCalledTimes(2));
    const firstCall = mockCreateSavingsGoal.mock.calls[0]?.[0] as {
      initialContributionIdempotencyKey?: string;
    };
    const secondCall = mockCreateSavingsGoal.mock.calls[1]?.[0] as {
      initialContributionIdempotencyKey?: string;
    };
    expect(firstCall.initialContributionIdempotencyKey).toBe(
      'initial-contribution-key-1'
    );
    expect(secondCall.initialContributionIdempotencyKey).toBe(
      'initial-contribution-key-1'
    );
    expect(mockRandomUUID).toHaveBeenCalledTimes(2);
  });

  it('creates the plan then shows its dedicated account for bank transfer funding', async () => {
    mockFetchSavingsPlanFunding.mockResolvedValue({
      status: 'ready',
      accounts: [
        {
          accountNumber: '0001234567',
          accountName: 'Synthetic account',
          bankName: 'Synthetic bank',
        },
      ],
    });
    render(<StartSavingsScreen />);

    selectSavingsProduct();
    setContributionAmount();
    acceptSavingsTerms();
    openFundingOptions();

    fireEvent.press(getSavingsButton('Pay with bank transfer'));
    fireEvent.press(getSavingsButton('Continue funding option'));

    await waitFor(() => expect(mockCreateSavingsGoal).toHaveBeenCalledTimes(1));
    expect(mockCreateSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        initialContributionAmount: 0,
        sourceMode: 'manual',
      })
    );
    await waitFor(() =>
      expect(screen.getByText('Fund your plan to continue')).toBeOnTheScreen()
    );
    fireEvent.changeText(
      screen.getByLabelText('BVN for plan account'),
      '00000000000'
    );
    fireEvent.press(screen.getByRole('button', { name: 'Show plan account' }));

    await waitFor(() =>
      expect(mockFetchSavingsPlanFunding).toHaveBeenCalledWith(
        expect.objectContaining({ bvn: '00000000000', goalId: 'goal-1' })
      )
    );
    await waitFor(() =>
      expect(screen.getByText('0001234567')).toBeOnTheScreen()
    );
  });

  it('creates an auto-debit savings goal with a selected saved card', async () => {
    render(<StartSavingsScreen />);

    selectSavingsProduct();
    setContributionAmount();
    fireEvent.press(getSavingsRadio('Use auto debit for savings'));
    acceptSavingsTerms();
    openFundingOptions();

    await waitFor(() =>
      expect(screen.getByText('Access Bank ending 1234')).toBeOnTheScreen()
    );
    fireEvent.press(getSavingsButton('Select Access Bank ending 1234'));
    fireEvent.press(getSavingsButton('Continue funding option'));

    await waitFor(() => expect(mockCreateSavingsGoal).toHaveBeenCalledTimes(1));
    expect(mockCreateSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        autoDebitAuthorized: true,
        initialContributionAmount: 0,
        productId: 'product-1',
        savedPaymentMethodId: 'card-1',
        sourceMode: 'auto_debit',
      })
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
