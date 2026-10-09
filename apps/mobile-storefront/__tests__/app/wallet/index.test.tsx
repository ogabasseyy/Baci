jest.mock('@/components/wallet/use-wallet-saved-cards', () => ({
  useWalletSavedCards: () => false,
}));
// Resolved legacy verdict: these tests exercise DVA derivation from payment
// settings and phone state, not the capability probe — the fixture merchant
// reads as server-confirmed legacy so creation gating reflects only the
// axis under test. Cold-start probe-wait behavior is covered in the
// funding-account controller tests.
jest.mock('@/lib/piggyvest-primary-capability', () => {
  const actual = jest.requireActual(
    '@/lib/piggyvest-primary-capability'
  ) as typeof import('@/lib/piggyvest-primary-capability');
  return { ...actual, usePiggyvestPrimaryCapability: () => false };
});

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Alert, Text, View } from 'react-native';
import { WALLET_TAB_SCROLL_PADDING_BOTTOM } from '@/components/wallet/wallet-tab.constants';
import { SPACING } from '@/constants/Colors';

type MockStorefrontScreenShellProps = {
  children?: ReactNode;
  edges?: readonly string[];
};

type MockWalletContentProps = {
  activeSavingsGoal?: unknown | null;
  canCreateFundingAccount?: boolean;
  contentContainerStyle?: unknown;
  createFundingAccountUnavailableMessage?: string;
  earningsBalance?: number;
  fundAmount: string;
  fundingAccount?: {
    accountName: string;
    accountNumber: string;
    bankName: string;
    provider: 'paystack';
  } | null;
  isAddingSavingsContribution?: boolean;
  isCreatingFundingAccount?: boolean;
  isFundPending: boolean;
  isRefetching?: boolean;
  loyaltyPoints?: number;
  onAddSavingsContribution?: () => void;
  onChangeSavingsDevice?: (
    product: unknown,
    variantId?: string | null
  ) => Promise<boolean>;
  onChangeSavingsContributionAmount?: (value: string) => void;
  onChangeFundAmount: (value: string) => void;
  onCreateFundingAccount?: () => void;
  onChangeRedeemPoints: (value: string) => void;
  onCloseSavingsProgress?: () => void;
  onConfirmFund: () => void;
  onConfirmRedeem: () => void;
  onFundSavingsWallet?: () => void;
  onManageCards?: () => void;
  onOpenFundPanel: () => void;
  onOpenRedeemPanel: () => void;
  onQuickSave?: () => void;
  onRefresh: () => void;
  onResetFund: () => void;
  onResetRedeem: () => void;
  onStartSavings?: () => void;
  redeemPoints: string;
  savingsContributionAmount?: string;
  savingsBalance?: number;
  showSavingsProgress?: boolean;
  showQuickSave?: boolean;
  showFundPanel: boolean;
  showRedeemPanel: boolean;
  totalBalance?: number;
  transactions?: unknown[];
  walletBalance?: number;
};

const mockRedirect = jest.fn<({ href }: { href: string }) => ReactNode>();
const mockRouterPush = jest.fn();
let mockSearchParams: {
  action?: string | string[];
  requiredAmount?: string | string[];
  returnTo?: string | string[];
  savingsAmount?: string | string[];
  savingsGoalId?: string | string[];
} = {};
const mockStorefrontScreenShell =
  jest.fn<({ children, edges }: MockStorefrontScreenShellProps) => void>();
const mockWalletContent =
  jest.fn<(props: MockWalletContentProps) => ReactNode>();
const mockGetScrollContentStyle = jest.fn();
const mockRefetch = jest.fn<() => Promise<unknown>>();
const mockMutateAsync =
  jest.fn<
    (points: number) => Promise<{
      conversionRate?: number;
      remainingPoints: number;
      walletCredit: number;
    }>
  >();
const mockTrackError = jest.fn();
const mockTrackEvent = jest.fn();
const mockLogWarn = jest.fn();
const mockScheduleLocalNotification = jest.fn();
const mockAddSavingsContribution =
  jest.fn<
    (...args: unknown[]) => Promise<{
      contributionId: string;
      goalCurrentAmount: number;
      goalStatus: 'active' | 'paused' | 'completed' | 'cancelled' | 'spent';
      success: boolean;
      walletBalance: number;
      walletTransactionId: string | null;
    }>
  >();
const mockSwapSavingsGoalDevice =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRandomUUID = jest.fn();
const mockUseRequireAuth = jest.fn();
const mockUseWallet = jest.fn();
const mockUseRedeemPoints = jest.fn();
const mockUseCreateWalletFundingAccount = jest.fn();
const mockUseMerchantPaymentSettings = jest.fn();
const mockUseStorefrontInsets = jest.fn();
let mockMerchantId = 'configured-merchant';
let mockMerchantSlug = 'ogabassey';
const mockInitializeWalletTopUp =
  jest.fn<
    (input: unknown) => Promise<{
      authorization_url: string;
      gateway: 'paystack' | 'korapay';
      reference: string;
      success: true;
    }>
  >();
const mockCreateFundingAccountMutateAsync =
  jest.fn<
    () => Promise<{
      account?: {
        accountNumber?: string | null;
        bankName?: string | null;
      } | null;
    }>
  >();
type MockAuthState = {
  customer: {
    email?: string;
    first_name?: string;
    id: string;
    last_name?: string;
    phone?: string;
  } | null;
  merchantId: string | null;
  user: { email?: string; id: string } | null;
};
const mockUseAuthStore = jest.fn<() => MockAuthState>();

function mockWalletSavingsGoal(
  activeSavingsGoal: unknown | null,
  balance = 125000
) {
  mockUseWallet.mockReturnValue({
    data: {
      wallet: {
        active_savings_goal: activeSavingsGoal,
        balance,
        earnings_available: true,
        earnings_balance: 125000,
        funding_account: null,
        loyalty_points: 2000,
        requires_funding_account_consent: true,
        savings_balance: activeSavingsGoal ? 120000 : 0,
        total_balance: balance + (activeSavingsGoal ? 120000 : 0),
      },
      transactions: [],
    },
    isError: false,
    isLoading: false,
    isRefetching: false,
    refetch: mockRefetch,
  });
}

function createActiveSavingsGoal(currentAmount = 120000) {
  return {
    contribution_amount: 500,
    contribution_frequency: 'weekly',
    current_amount: currentAmount,
    id: 'goal-1',
    maturity_date: '2026-09-30',
    source_mode: 'manual',
    status: 'active',
    target_amount: 700000,
    title: 'iPhone 15 Pro',
  };
}

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => mockRedirect({ href }),
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
  Stack: {
    Screen: () => null,
  },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}));

jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({
    children,
    ...props
  }: MockStorefrontScreenShellProps) => {
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    mockStorefrontScreenShell({ children, ...props });
    return <View testID="storefront-screen-shell">{children}</View>;
  },
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/hooks/use-auth-guard', () => ({
  useRequireAuth: () => mockUseRequireAuth(),
}));

jest.mock('@/hooks/use-storefront-insets', () => ({
  useStorefrontInsets: () => mockUseStorefrontInsets(),
}));

jest.mock('@/hooks/use-wallet', () => ({
  useCreateWalletFundingAccount: () => mockUseCreateWalletFundingAccount(),
  useRedeemPoints: () => mockUseRedeemPoints(),
  useWallet: (...args: unknown[]) => mockUseWallet(...args),
}));

jest.mock('@/hooks/useMerchantPaymentSettings', () => ({
  useMerchantPaymentSettings: () => mockUseMerchantPaymentSettings(),
}));

jest.mock('@/lib/config', () => ({
  CONFIG: {
    get MERCHANT_ID() {
      return mockMerchantId;
    },
    get MERCHANT_SLUG() {
      return mockMerchantSlug;
    },
  },
}));

jest.mock('@/lib/wallet-top-up', () => ({
  initializeWalletTopUp: (input: unknown) => mockInitializeWalletTopUp(input),
}));

jest.mock('@/lib/customer-savings', () => ({
  addSavingsContribution: (input: unknown) => mockAddSavingsContribution(input),
  swapSavingsGoalDevice: (input: unknown) => mockSwapSavingsGoalDevice(input),
}));

jest.mock('@/services/analytics', () => ({
  trackError: (...args: unknown[]) => mockTrackError(...args),
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

jest.mock('@/services/push-notifications', () => ({
  scheduleLocalNotification: (...args: unknown[]) =>
    mockScheduleLocalNotification(...args),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: {
      customer: { id: string } | null;
      merchantId: string | null;
      user: { id: string } | null;
    }) => unknown
  ) => selector(mockUseAuthStore()),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: jest.fn(),
    warn: (...args: unknown[]) => mockLogWarn(...args),
  }),
}));

jest.mock('@/components/wallet/WalletContent', () => ({
  WalletContent: (props: MockWalletContentProps) => mockWalletContent(props),
}));

const WalletScreen = require('@/app/wallet')
  .default as typeof import('@/app/wallet').default;

describe('WalletScreen', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockSearchParams = {};
    mockMerchantId = 'configured-merchant';
    mockMerchantSlug = 'ogabassey';
    mockRefetch.mockResolvedValue(undefined);
    mockRedirect.mockImplementation(({ href }) => (
      <View testID="wallet-redirect" accessibilityLabel={href} />
    ));
    mockWalletContent.mockImplementation((props) => (
      <View testID="wallet-content">
        <Text>{`earnings-balance:${props.earningsBalance ?? 0}`}</Text>
        <Text>{`savings-balance:${props.savingsBalance ?? 0}`}</Text>
        <Text>{`total-balance:${props.totalBalance ?? 0}`}</Text>
        <Text>{`show-fund-panel:${String(props.showFundPanel)}`}</Text>
        <Text>{`fund-amount:${props.fundAmount}`}</Text>
        <Text>{`fund-pending:${String(props.isFundPending)}`}</Text>
        <Text>{`loyalty-points:${props.loyaltyPoints ?? 0}`}</Text>
        <Text>{`show-redeem-panel:${String(props.showRedeemPanel)}`}</Text>
        <Text>{`redeem-points:${props.redeemPoints}`}</Text>
        <Text>{`savings-contribution-amount:${props.savingsContributionAmount ?? ''}`}</Text>
        <Text>{`show-savings-progress:${String(
          props.showSavingsProgress ?? false
        )}`}</Text>
        <Text>{`adding-savings:${String(
          props.isAddingSavingsContribution ?? false
        )}`}</Text>
        <Text>{`transactions:${props.transactions?.length ?? 0}`}</Text>
        <Text>{`refreshing:${String(props.isRefetching)}`}</Text>
        <Text>{`show-quick-save:${String(props.showQuickSave ?? false)}`}</Text>
        <Text>{`can-create-funding-account:${String(
          props.canCreateFundingAccount ?? false
        )}`}</Text>
        <Text>{`create-funding-account-message:${
          props.createFundingAccountUnavailableMessage ?? ''
        }`}</Text>
        <Text>{`content-style:${JSON.stringify(props.contentContainerStyle)}`}</Text>
        <Text accessibilityRole="button" onPress={props.onOpenFundPanel}>
          Open Fund Panel
        </Text>
        <Text accessibilityRole="button" onPress={props.onCreateFundingAccount}>
          Create Funding Account
        </Text>
        <Text accessibilityRole="button" onPress={props.onStartSavings}>
          Open Start Savings
        </Text>
        <Text accessibilityRole="button" onPress={props.onManageCards}>
          Open Manage Cards
        </Text>
        <Text
          accessibilityRole="button"
          onPress={() => props.onChangeFundAmount('50')}
        >
          Set Invalid Fund Amount
        </Text>
        <Text
          accessibilityRole="button"
          onPress={() => props.onChangeFundAmount('2500')}
        >
          Set Valid Fund Amount
        </Text>
        <Text accessibilityRole="button" onPress={props.onConfirmFund}>
          Confirm Fund
        </Text>
        <Text accessibilityRole="button" onPress={props.onResetFund}>
          Reset Fund
        </Text>
        <Text accessibilityRole="button" onPress={props.onOpenRedeemPanel}>
          Open Redeem Panel
        </Text>
        <Text
          accessibilityRole="button"
          onPress={() => props.onChangeRedeemPoints('0')}
        >
          Set Invalid Redeem Points
        </Text>
        <Text
          accessibilityRole="button"
          onPress={() => props.onChangeRedeemPoints('150')}
        >
          Set Block Invalid Redeem Points
        </Text>
        <Text
          accessibilityRole="button"
          onPress={() => props.onChangeRedeemPoints('2100')}
        >
          Set Over Balance Redeem Points
        </Text>
        <Text
          accessibilityRole="button"
          onPress={() => props.onChangeRedeemPoints('200')}
        >
          Set Valid Redeem Points
        </Text>
        <Text
          accessibilityRole="button"
          onPress={() => props.onChangeSavingsContributionAmount?.('500')}
        >
          Set Savings Contribution
        </Text>
        <Text
          accessibilityRole="button"
          onPress={props.onAddSavingsContribution}
        >
          Confirm Savings Contribution
        </Text>
        <Text accessibilityRole="button" onPress={props.onFundSavingsWallet}>
          Fund Savings Wallet
        </Text>
        <Text accessibilityRole="button" onPress={props.onConfirmRedeem}>
          Confirm Redeem
        </Text>
        <Text accessibilityRole="button" onPress={props.onResetRedeem}>
          Reset Redeem
        </Text>
        <Text accessibilityRole="button" onPress={props.onRefresh}>
          Refresh Wallet
        </Text>
      </View>
    ));
    mockGetScrollContentStyle.mockReturnValue({
      paddingTop: 20,
      paddingBottom: 32,
    });
    mockUseStorefrontInsets.mockReturnValue({
      getScrollContentStyle: mockGetScrollContentStyle,
    });
    mockUseRequireAuth.mockReturnValue({
      isLoading: false,
      redirectTo: null,
    });
    mockUseWallet.mockReturnValue({
      data: {
        wallet: {
          balance: 125000,
          earnings_available: true,
          earnings_balance: 125000,
          funding_account: null,
          loyalty_points: 2000,
          requires_funding_account_consent: true,
          savings_balance: 0,
          total_balance: 125000,
        },
        transactions: [
          {
            amount: 2500,
            created_at: '2026-04-21T12:30:00.000Z',
            description: 'Order cashback',
            id: 'tx-1',
            type: 'credit',
          },
        ],
      },
      isError: false,
      isLoading: false,
      isRefetching: false,
      refetch: mockRefetch,
    });
    mockUseRedeemPoints.mockReturnValue({
      isPending: false,
      mutateAsync: mockMutateAsync,
    });
    mockUseCreateWalletFundingAccount.mockReturnValue({
      isPending: false,
      mutateAsync: mockCreateFundingAccountMutateAsync,
    });
    mockUseMerchantPaymentSettings.mockReturnValue({
      data: { wallet_paystack_dva_enabled: true },
      isError: false,
      isLoading: false,
      isPending: false,
    });
    mockUseAuthStore.mockReturnValue({
      customer: {
        email: 'customer@example.com',
        first_name: 'Ada',
        id: 'customer-1',
        last_name: 'Lovelace',
        phone: '08012345678',
      },
      merchantId: 'merchant-1',
      user: { email: 'customer@example.com', id: 'user-1' },
    });
    mockInitializeWalletTopUp.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/wallet',
      gateway: 'paystack',
      reference: 'WAL-123',
      success: true,
    });
    mockAddSavingsContribution.mockResolvedValue({
      contributionId: 'contribution-1',
      goalCurrentAmount: 500,
      goalStatus: 'active',
      success: true,
      walletBalance: 124500,
      walletTransactionId: 'wallet-tx-1',
    });
    mockSwapSavingsGoalDevice.mockResolvedValue({
      currentAmount: 120000,
      goalId: 'goal-1',
      goalStatus: 'active',
      success: true,
      targetAmount: 650000,
    });
    mockRandomUUID.mockReturnValue('savings-key-1');
  });

  it('uses the storefront shell, inset helper, and mapped wallet content props', () => {
    render(<WalletScreen />);

    const shellProps = mockStorefrontScreenShell.mock.calls[0]?.[0];
    const walletContentProps = mockWalletContent.mock.calls[0]?.[0];

    expect(shellProps?.edges).toEqual(['bottom']);
    expect(mockGetScrollContentStyle).toHaveBeenCalledWith({
      includeBottomInset: false,
      paddingBottom: SPACING.xl,
    });
    expect(walletContentProps?.earningsBalance).toBe(125000);
    expect(walletContentProps?.totalBalance).toBe(125000);
    expect(walletContentProps?.loyaltyPoints).toBe(2000);
    expect(walletContentProps?.transactions).toHaveLength(1);
  });

  it('uses the display wallet cache policy for the wallet screen', () => {
    render(<WalletScreen />);

    expect(mockUseWallet).toHaveBeenCalledWith({ cachePolicy: 'display' });
  });

  it('passes wallet DVA availability through to wallet content', () => {
    render(<WalletScreen />);

    expect(
      screen.getByText('can-create-funding-account:true')
    ).toBeOnTheScreen();
    expect(
      screen.getByText('create-funding-account-message:')
    ).toBeOnTheScreen();
  });

  it('keeps account creation unavailable while merchant payment settings load', () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockUseMerchantPaymentSettings.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: true,
      isPending: true,
    });

    render(<WalletScreen />);

    expect(
      screen.getByText('can-create-funding-account:false')
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        'create-funding-account-message:Checking account number availability...'
      )
    ).toBeOnTheScreen();

    fireEvent.press(
      screen.getByRole('button', { name: 'Create Funding Account' })
    );

    expect(alertSpy).toHaveBeenCalledWith(
      'Account number unavailable',
      'Checking account number availability...'
    );
    expect(mockCreateFundingAccountMutateAsync).not.toHaveBeenCalled();
  });

  it('blocks account number creation when merchant wallet DVA is disabled', () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockUseMerchantPaymentSettings.mockReturnValue({
      data: { wallet_paystack_dva_enabled: false },
      isError: false,
      isLoading: false,
      isPending: false,
    });

    render(<WalletScreen />);

    expect(
      screen.getByText('can-create-funding-account:false')
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        'create-funding-account-message:Bank transfer account creation is not available yet.'
      )
    ).toBeOnTheScreen();

    fireEvent.press(
      screen.getByRole('button', { name: 'Create Funding Account' })
    );

    expect(alertSpy).toHaveBeenCalledWith(
      'Account number unavailable',
      'Bank transfer account creation is not available yet.'
    );
    expect(mockCreateFundingAccountMutateAsync).not.toHaveBeenCalled();
  });

  it('blocks account number creation when the customer has no phone number', () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockUseAuthStore.mockReturnValue({
      customer: {
        email: 'customer@example.com',
        first_name: 'Ada',
        id: 'customer-1',
        last_name: 'Lovelace',
      },
      merchantId: 'merchant-1',
      user: { email: 'customer@example.com', id: 'user-1' },
    });

    render(<WalletScreen />);

    expect(
      screen.getByText('can-create-funding-account:false')
    ).toBeOnTheScreen();
    // Missing phone is now collected at the point of need, so the static
    // PHONE_REQUIRED copy is suppressed (the fund panel's phone prompt replaces
    // it) while creation stays blocked.
    expect(
      screen.getByText('create-funding-account-message:')
    ).toBeOnTheScreen();
    expect(
      screen.queryByText(
        'create-funding-account-message:Add a phone number to your profile before creating a wallet account number.'
      )
    ).not.toBeOnTheScreen();

    fireEvent.press(
      screen.getByRole('button', { name: 'Create Funding Account' })
    );

    expect(alertSpy).toHaveBeenCalledWith(
      'Phone number required',
      'Add a phone number to your profile before creating a wallet account number.'
    );
    expect(mockCreateFundingAccountMutateAsync).not.toHaveBeenCalled();
  });

  it('creates a wallet account number when DVA and customer phone are available', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockCreateFundingAccountMutateAsync.mockResolvedValueOnce({
      account: {
        accountNumber: '1234567890',
        bankName: 'Titan Paystack',
      },
    });

    render(<WalletScreen />);

    fireEvent.press(
      screen.getByRole('button', { name: 'Create Funding Account' })
    );

    await waitFor(() => {
      expect(mockCreateFundingAccountMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('does not announce account details when the provider returns no account summary', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockCreateFundingAccountMutateAsync.mockResolvedValueOnce({
      account: null,
    });

    render(<WalletScreen />);

    fireEvent.press(
      screen.getByRole('button', { name: 'Create Funding Account' })
    );

    await waitFor(() => {
      expect(mockCreateFundingAccountMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(alertSpy).not.toHaveBeenCalledWith(
      'Account Ready',
      expect.any(String)
    );
  });

  it('reports funding account creation failures without swallowing the backend message', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockCreateFundingAccountMutateAsync.mockRejectedValueOnce(
      new Error('Account creation failed')
    );

    render(<WalletScreen />);

    fireEvent.press(
      screen.getByRole('button', { name: 'Create Funding Account' })
    );

    await waitFor(() => {
      expect(mockCreateFundingAccountMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mockTrackError).toHaveBeenCalledWith(
      'wallet_funding_account_create_failed',
      'Account creation failed',
      expect.objectContaining({
        customer_id: 'customer-1',
        merchant_id: 'merchant-1',
        merchant_slug: 'ogabassey',
      })
    );
    expect(alertSpy).toHaveBeenCalledWith(
      'Unable to create account number',
      'Account creation failed'
    );
  });

  it('logs when wallet balance API fields fall back locally', () => {
    mockUseWallet.mockReturnValue({
      data: {
        wallet: {
          balance: 125000,
          funding_account: null,
          loyalty_points: 2000,
          requires_funding_account_consent: true,
        },
        transactions: [],
      },
      isError: false,
      isLoading: false,
      isRefetching: false,
      refetch: mockRefetch,
    });

    render(<WalletScreen />);

    expect(screen.getByText('earnings-balance:0')).toBeOnTheScreen();
    expect(screen.getByText('savings-balance:0')).toBeOnTheScreen();
    expect(screen.getByText('total-balance:125000')).toBeOnTheScreen();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('Wallet API balance contract warning'),
      expect.objectContaining({
        computedTotalBalance: 125000,
        missingFields: ['savings_balance', 'total_balance'],
      })
    );
  });

  it('scopes wallet balance warning dedupe by customer context', () => {
    mockUseWallet.mockReturnValue({
      data: {
        wallet: {
          balance: 125000,
          funding_account: null,
          loyalty_points: 2000,
          requires_funding_account_consent: true,
        },
        transactions: [],
      },
      isError: false,
      isLoading: false,
      isRefetching: false,
      refetch: mockRefetch,
    });
    mockUseAuthStore.mockReturnValue({
      customer: {
        email: 'first@example.com',
        id: 'customer-warning-1',
      },
      merchantId: 'merchant-1',
      user: { email: 'first@example.com', id: 'user-warning-1' },
    });

    const first = render(<WalletScreen />);

    expect(mockLogWarn).toHaveBeenCalledTimes(1);
    mockLogWarn.mockClear();
    first.unmount();

    mockUseAuthStore.mockReturnValue({
      customer: {
        email: 'second@example.com',
        id: 'customer-warning-2',
      },
      merchantId: 'merchant-1',
      user: { email: 'second@example.com', id: 'user-warning-2' },
    });

    render(<WalletScreen />);

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('Wallet API balance contract warning'),
      expect.objectContaining({
        ownerId: 'customer-warning-2',
      })
    );
  });

  it('logs when wallet total balance disagrees with computed balances', () => {
    mockUseWallet.mockReturnValue({
      data: {
        wallet: {
          balance: 125000,
          earnings_available: true,
          earnings_balance: 125000,
          funding_account: null,
          loyalty_points: 2000,
          requires_funding_account_consent: true,
          savings_balance: 50000,
          total_balance: 999999,
        },
        transactions: [],
      },
      isError: false,
      isLoading: false,
      isRefetching: false,
      refetch: mockRefetch,
    });

    render(<WalletScreen />);

    expect(screen.getByText('earnings-balance:125000')).toBeOnTheScreen();
    expect(screen.getByText('savings-balance:50000')).toBeOnTheScreen();
    expect(screen.getByText('total-balance:999999')).toBeOnTheScreen();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('Wallet API balance contract warning'),
      expect.objectContaining({
        computedTotalBalance: 175000,
        mismatchedFields: ['total_balance'],
        serverTotalBalance: 999999,
      })
    );
  });

  it('renders as the wallet tab core screen without the pushed stack header', () => {
    render(<WalletScreen presentation="tab" />);

    const shellProps = mockStorefrontScreenShell.mock.calls[0]?.[0];

    expect(shellProps?.edges).toEqual(['top']);
    expect(screen.getByText('Wallet & Loyalty')).toBeOnTheScreen();
    expect(mockGetScrollContentStyle).toHaveBeenCalledWith({
      includeBottomInset: true,
      paddingBottom: WALLET_TAB_SCROLL_PADDING_BOTTOM,
    });
  });

  it('redirects unauthenticated users to the login flow', () => {
    mockUseRequireAuth.mockReturnValue({
      isLoading: false,
      redirectTo: '/auth/login?returnTo=%2Fwallet',
    });
    mockUseAuthStore.mockReturnValue({
      customer: null,
      merchantId: 'merchant-1',
      user: null,
    });

    render(<WalletScreen />);

    expect(mockRedirect).toHaveBeenCalledWith({
      href: '/auth/login?returnTo=%2Fwallet',
    });
    expect(screen.getByTestId('wallet-redirect').props.accessibilityLabel).toBe(
      '/auth/login?returnTo=%2Fwallet'
    );
  });

  it('shows the preparing state when the wallet owner context is not ready', () => {
    mockUseAuthStore.mockReturnValue({
      customer: null,
      merchantId: null,
      user: null,
    });

    render(<WalletScreen />);

    expect(screen.getByText('Preparing your wallet...')).toBeOnTheScreen();
    expect(screen.getByLabelText('Preparing wallet')).toBeOnTheScreen();
  });

  it('renders wallet data while the customer record is still hydrating', () => {
    mockUseAuthStore.mockReturnValue({
      customer: null,
      merchantId: 'merchant-1',
      user: { id: 'user-1' },
    });

    render(<WalletScreen />);

    expect(screen.getByText('earnings-balance:125000')).toBeOnTheScreen();
    expect(screen.getByText('total-balance:125000')).toBeOnTheScreen();
    expect(screen.queryByText('Preparing your wallet...')).toBeNull();
  });

  it('renders wallet data when auth merchant id is still hydrating but app config has one', () => {
    mockUseAuthStore.mockReturnValue({
      customer: null,
      merchantId: null,
      user: { email: 'customer@example.com', id: 'user-1' },
    });

    render(<WalletScreen />);

    expect(screen.getByText('earnings-balance:125000')).toBeOnTheScreen();
    expect(screen.getByText('total-balance:125000')).toBeOnTheScreen();
    expect(screen.queryByText('Preparing your wallet...')).toBeNull();
  });

  it('starts a wallet top-up and routes through the payment gateway', async () => {
    render(<WalletScreen />);

    fireEvent.press(screen.getByText('Open Fund Panel'));
    fireEvent.press(screen.getByText('Set Valid Fund Amount'));
    fireEvent.press(screen.getByText('Confirm Fund'));

    await waitFor(() => {
      expect(mockInitializeWalletTopUp).toHaveBeenCalledWith({
        amount: 2500,
        customerName: 'Ada Lovelace',
        customerPhone: '08012345678',
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
      });
    });
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/payment-gateway',
      params: {
        amount: '2500',
        authorizationUrl: 'https://checkout.paystack.com/wallet',
        gateway: 'paystack',
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        paymentKind: 'wallet',
        reference: 'WAL-123',
      },
    });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'wallet_top_up_started',
      expect.objectContaining({
        amount: 2500,
        customer_id: 'customer-1',
        gateway: 'paystack',
      })
    );
  });

  it('routes to start savings and manage cards screens', () => {
    render(<WalletScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Open Start Savings' }));
    fireEvent.press(screen.getByRole('button', { name: 'Open Manage Cards' }));

    expect(mockRouterPush).toHaveBeenNthCalledWith(1, '/wallet/savings/start');
    expect(mockRouterPush).toHaveBeenNthCalledWith(2, '/wallet/manage-cards');
  });

  it('opens the savings progress flow without starting wallet-only funding', () => {
    mockWalletSavingsGoal(createActiveSavingsGoal(0), 0);
    render(<WalletScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Open Start Savings' }));
    fireEvent.press(
      screen.getByRole('button', { name: 'Set Savings Contribution' })
    );
    expect(mockInitializeWalletTopUp).not.toHaveBeenCalled();
    expect(screen.getByText('show-fund-panel:false')).toBeOnTheScreen();
    expect(screen.getByText('show-savings-progress:true')).toBeOnTheScreen();
    expect(mockRouterPush).not.toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/payment-gateway' })
    );
  });

  it('restores the entered contribution when payment returns to savings', () => {
    mockSearchParams = {
      action: 'savings',
      savingsAmount: '500',
    };
    mockWalletSavingsGoal(createActiveSavingsGoal(0), 500);

    render(<WalletScreen />);

    expect(screen.getByText('show-savings-progress:true')).toBeOnTheScreen();
    expect(screen.getByText('show-fund-panel:false')).toBeOnTheScreen();
    expect(
      screen.getByText('savings-contribution-amount:500')
    ).toBeOnTheScreen();
  });

  it('takes the first value when savings params repeat in the URL', () => {
    mockSearchParams = {
      action: ['savings', 'fund'],
      savingsAmount: ['500', '999'],
      savingsGoalId: ['goal-1', 'goal-2'],
    };
    mockWalletSavingsGoal(createActiveSavingsGoal(0), 500);

    render(<WalletScreen />);

    expect(
      screen.getByText('savings-contribution-amount:500')
    ).toBeOnTheScreen();
  });

  it('treats empty-array params as absent like the funding route', () => {
    mockSearchParams = {
      action: [],
      savingsAmount: [],
      savingsGoalId: [],
    };
    mockWalletSavingsGoal(createActiveSavingsGoal(0), 500);

    render(<WalletScreen />);

    expect(screen.getByText('savings-contribution-amount:')).toBeOnTheScreen();
  });

  it('keeps the savings plan open if its wallet payment cannot start', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockWalletSavingsGoal(createActiveSavingsGoal(0), 0);
    mockInitializeWalletTopUp.mockRejectedValueOnce(
      new Error('Payment unavailable')
    );

    try {
      render(<WalletScreen />);
      fireEvent.press(
        screen.getByRole('button', { name: 'Open Start Savings' })
      );
      fireEvent.press(
        screen.getByRole('button', { name: 'Set Savings Contribution' })
      );
      fireEvent.press(
        screen.getByRole('button', { name: 'Fund Savings Wallet' })
      );

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(
          'Top-up Failed',
          'Payment unavailable'
        );
      });
      expect(screen.getByText('show-savings-progress:true')).toBeOnTheScreen();
      expect(
        screen.getByText('savings-contribution-amount:500')
      ).toBeOnTheScreen();
      expect(screen.getByText('show-fund-panel:false')).toBeOnTheScreen();
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('opens active savings progress and adds a manual contribution', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockUseWallet.mockReturnValue({
      data: {
        wallet: {
          active_savings_goal: {
            contribution_amount: 500,
            contribution_frequency: 'weekly',
            current_amount: 0,
            id: 'goal-1',
            maturity_date: '2026-09-30',
            source_mode: 'manual',
            status: 'active',
            target_amount: 100000,
            title: 'iPhone 15 Pro',
          },
          balance: 125000,
          earnings_balance: 125000,
          funding_account: null,
          loyalty_points: 2000,
          requires_funding_account_consent: true,
          savings_balance: 0,
          total_balance: 125000,
        },
        transactions: [],
      },
      isError: false,
      isLoading: false,
      isRefetching: false,
      refetch: mockRefetch,
    });

    try {
      render(<WalletScreen />);

      fireEvent.press(
        screen.getByRole('button', { name: 'Open Start Savings' })
      );

      expect(mockRouterPush).not.toHaveBeenCalledWith('/wallet/savings/start');
      expect(screen.getByText('show-savings-progress:true')).toBeOnTheScreen();

      fireEvent.press(
        screen.getByRole('button', { name: 'Set Savings Contribution' })
      );
      await act(async () => {
        fireEvent.press(
          screen.getByRole('button', { name: 'Confirm Savings Contribution' })
        );
        await Promise.resolve();
      });

      expect(mockAddSavingsContribution).toHaveBeenCalledWith({
        amount: 500,
        goalId: 'goal-1',
        idempotencyKey: 'savings-key-1',
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
      });
      expect(mockRefetch).toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        'Savings updated',
        'Added ₦500 to your savings goal.'
      );
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('shows an error when active savings contribution fails', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockAddSavingsContribution.mockRejectedValue(
      new Error('Contribution failed')
    );
    mockUseWallet.mockReturnValue({
      data: {
        wallet: {
          active_savings_goal: {
            contribution_amount: 500,
            contribution_frequency: 'weekly',
            current_amount: 0,
            id: 'goal-1',
            maturity_date: '2026-09-30',
            source_mode: 'manual',
            status: 'active',
            target_amount: 100000,
            title: 'iPhone 15 Pro',
          },
          balance: 125000,
          earnings_balance: 125000,
          funding_account: null,
          loyalty_points: 2000,
          requires_funding_account_consent: true,
          savings_balance: 0,
          total_balance: 125000,
        },
        transactions: [],
      },
      isError: false,
      isLoading: false,
      isRefetching: false,
      refetch: mockRefetch,
    });

    try {
      render(<WalletScreen />);

      fireEvent.press(
        screen.getByRole('button', { name: 'Open Start Savings' })
      );
      fireEvent.press(
        screen.getByRole('button', { name: 'Set Savings Contribution' })
      );
      await act(async () => {
        fireEvent.press(
          screen.getByRole('button', { name: 'Confirm Savings Contribution' })
        );
        await Promise.resolve();
      });

      expect(mockAddSavingsContribution).toHaveBeenCalledWith({
        amount: 500,
        goalId: 'goal-1',
        idempotencyKey: 'savings-key-1',
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
      });
      expect(mockRefetch).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        'Unable to add savings',
        'Contribution failed'
      );
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('changes an active savings goal device with the active merchant context', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockUseWallet.mockReturnValue({
      data: {
        wallet: {
          active_savings_goal: {
            contribution_amount: 500,
            contribution_frequency: 'weekly',
            current_amount: 120000,
            id: 'goal-1',
            maturity_date: '2026-09-30',
            source_mode: 'manual',
            status: 'active',
            target_amount: 700000,
            title: 'iPhone 15 Pro',
          },
          balance: 125000,
          earnings_balance: 125000,
          funding_account: null,
          loyalty_points: 2000,
          requires_funding_account_consent: true,
          savings_balance: 120000,
          total_balance: 245000,
        },
        transactions: [],
      },
      isError: false,
      isLoading: false,
      isRefetching: false,
      refetch: mockRefetch,
    });

    try {
      render(<WalletScreen />);

      const walletContentProps = mockWalletContent.mock.calls[0]?.[0];
      const didChange = await walletContentProps?.onChangeSavingsDevice?.(
        {
          id: 'product-2',
          image: 'https://cdn.example.com/iphone-16.jpg',
          name: 'iPhone 16 Pro',
          price: 750000,
          slug: 'iphone-16-pro',
          variants: [
            {
              attributes: { storage: '256GB' },
              id: 'variant-256',
              name: '256GB',
              price: 650000,
            },
          ],
        },
        'variant-256'
      );

      expect(didChange).toBe(true);
      expect(mockSwapSavingsGoalDevice).toHaveBeenCalledWith({
        goalId: 'goal-1',
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        productId: 'product-2',
        variantId: 'variant-256',
      });
      expect(mockRefetch).toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        'Device updated',
        'Your savings goal is now for iPhone 16 Pro.'
      );
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('does not change an active savings goal to a device below saved amount', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockUseWallet.mockReturnValue({
      data: {
        wallet: {
          active_savings_goal: {
            contribution_amount: 500,
            contribution_frequency: 'weekly',
            current_amount: 120000,
            id: 'goal-1',
            maturity_date: '2026-09-30',
            source_mode: 'manual',
            status: 'active',
            target_amount: 700000,
            title: 'iPhone 15 Pro',
          },
          balance: 125000,
          earnings_balance: 125000,
          funding_account: null,
          loyalty_points: 2000,
          requires_funding_account_consent: true,
          savings_balance: 120000,
          total_balance: 245000,
        },
        transactions: [],
      },
      isError: false,
      isLoading: false,
      isRefetching: false,
      refetch: mockRefetch,
    });

    try {
      render(<WalletScreen />);

      const walletContentProps = mockWalletContent.mock.calls[0]?.[0];
      const didChange = await walletContentProps?.onChangeSavingsDevice?.(
        {
          id: 'product-3',
          image: 'https://cdn.example.com/budget.jpg',
          name: 'Budget Phone',
          price: 90000,
          slug: 'budget-phone',
        },
        null
      );

      expect(didChange).toBe(false);
      expect(mockSwapSavingsGoalDevice).not.toHaveBeenCalled();
      expect(mockRefetch).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        'Device price too low',
        'You have already saved ₦120,000. Choose a device priced at or above this amount.'
      );
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('shows an error when changing the savings device fails', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockSwapSavingsGoalDevice.mockRejectedValue(new Error('Swap failed'));
    mockWalletSavingsGoal(createActiveSavingsGoal());

    try {
      render(<WalletScreen />);

      const walletContentProps = mockWalletContent.mock.calls[0]?.[0];
      const didChange = await walletContentProps?.onChangeSavingsDevice?.(
        {
          id: 'product-2',
          image: 'https://cdn.example.com/iphone-16.jpg',
          name: 'iPhone 16 Pro',
          price: 750000,
          slug: 'iphone-16-pro',
        },
        null
      );

      expect(didChange).toBe(false);
      expect(mockSwapSavingsGoalDevice).toHaveBeenCalled();
      expect(mockRefetch).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        'Unable to change device',
        'Swap failed'
      );
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('keeps the device change when wallet refresh fails after swap', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockRefetch.mockRejectedValueOnce(new Error('Refresh failed'));
    mockWalletSavingsGoal(createActiveSavingsGoal());

    try {
      render(<WalletScreen />);

      const walletContentProps = mockWalletContent.mock.calls[0]?.[0];
      const didChange = await walletContentProps?.onChangeSavingsDevice?.(
        {
          id: 'product-2',
          image: 'https://cdn.example.com/iphone-16.jpg',
          name: 'iPhone 16 Pro',
          price: 750000,
          slug: 'iphone-16-pro',
        },
        null
      );

      expect(didChange).toBe(true);
      expect(mockSwapSavingsGoalDevice).toHaveBeenCalled();
      expect(mockRefetch).toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        'Device updated',
        'Your savings device was updated, but wallet refresh failed. Pull to refresh your latest goal.'
      );
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('does not change savings device without an active savings goal', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockWalletSavingsGoal(null);

    try {
      render(<WalletScreen />);

      const walletContentProps = mockWalletContent.mock.calls[0]?.[0];
      const didChange = await walletContentProps?.onChangeSavingsDevice?.(
        {
          id: 'product-2',
          image: 'https://cdn.example.com/iphone-16.jpg',
          name: 'iPhone 16 Pro',
          price: 750000,
          slug: 'iphone-16-pro',
        },
        null
      );

      expect(didChange).toBe(false);
      expect(mockSwapSavingsGoalDevice).not.toHaveBeenCalled();
      expect(mockRefetch).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        'No active savings goal',
        'Start a savings goal first.'
      );
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('allows changing to a device priced at the saved amount boundary', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockWalletSavingsGoal(createActiveSavingsGoal(120000));

    try {
      render(<WalletScreen />);

      const walletContentProps = mockWalletContent.mock.calls[0]?.[0];
      const didChange = await walletContentProps?.onChangeSavingsDevice?.(
        {
          id: 'product-2',
          image: 'https://cdn.example.com/equal.jpg',
          name: 'Equal Price Phone',
          price: 120000,
          slug: 'equal-price-phone',
        },
        null
      );

      expect(didChange).toBe(true);
      expect(mockSwapSavingsGoalDevice).toHaveBeenCalledWith(
        expect.objectContaining({
          goalId: 'goal-1',
          productId: 'product-2',
          variantId: null,
        })
      );
      expect(mockRefetch).toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        'Device updated',
        'Your savings goal is now for Equal Price Phone.'
      );
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('routes wallet top-ups with slug fallback when merchant id is blank', async () => {
    mockMerchantId = '';
    mockUseAuthStore.mockReturnValue({
      customer: {
        email: 'customer@example.com',
        first_name: 'Ada',
        id: 'customer-1',
        last_name: 'Lovelace',
        phone: '08012345678',
      },
      merchantId: '   ',
      user: { email: 'customer@example.com', id: 'user-1' },
    });

    render(<WalletScreen />);

    fireEvent.press(screen.getByText('Open Fund Panel'));
    fireEvent.press(screen.getByText('Set Valid Fund Amount'));
    fireEvent.press(screen.getByText('Confirm Fund'));

    await waitFor(() => {
      expect(mockInitializeWalletTopUp).toHaveBeenCalledWith({
        amount: 2500,
        customerName: 'Ada Lovelace',
        customerPhone: '08012345678',
        merchantId: undefined,
        merchantSlug: 'ogabassey',
      });
    });

    const pushArg = mockRouterPush.mock.calls[0]?.[0] as {
      params: Record<string, string>;
      pathname: string;
    };
    expect(pushArg).toEqual({
      pathname: '/payment-gateway',
      params: {
        amount: '2500',
        authorizationUrl: 'https://checkout.paystack.com/wallet',
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
        paymentKind: 'wallet',
        reference: 'WAL-123',
      },
    });
    expect(pushArg.params).not.toHaveProperty('merchantId');
  });

  it('omits blank merchant slugs from wallet top-up route params when merchant id is available', async () => {
    mockMerchantSlug = '   ';

    render(<WalletScreen />);

    fireEvent.press(screen.getByText('Open Fund Panel'));
    fireEvent.press(screen.getByText('Set Valid Fund Amount'));
    fireEvent.press(screen.getByText('Confirm Fund'));

    await waitFor(() => {
      expect(mockInitializeWalletTopUp).toHaveBeenCalledWith({
        amount: 2500,
        customerName: 'Ada Lovelace',
        customerPhone: '08012345678',
        merchantId: 'merchant-1',
        merchantSlug: undefined,
      });
    });

    const pushArg = mockRouterPush.mock.calls[0]?.[0] as {
      params: Record<string, string>;
      pathname: string;
    };
    expect(pushArg).toEqual({
      pathname: '/payment-gateway',
      params: {
        amount: '2500',
        authorizationUrl: 'https://checkout.paystack.com/wallet',
        gateway: 'paystack',
        merchantId: 'merchant-1',
        paymentKind: 'wallet',
        reference: 'WAL-123',
      },
    });
    expect(pushArg.params).not.toHaveProperty('merchantSlug');
  });

  it('opens the wallet top-up panel from the route action', () => {
    mockSearchParams = { action: 'fund' };

    render(<WalletScreen />);

    expect(screen.getByText('show-fund-panel:true')).toBeOnTheScreen();
    expect(screen.getByText('show-redeem-panel:false')).toBeOnTheScreen();
  });

  it('prefills requiredAmount and passes returnTo to payment gateway', async () => {
    mockSearchParams = {
      action: 'fund',
      requiredAmount: '1000',
      returnTo: '/imei-check',
    };

    render(<WalletScreen />);

    expect(screen.getByText('show-fund-panel:true')).toBeOnTheScreen();
    expect(screen.getByText('fund-amount:1000')).toBeOnTheScreen();

    fireEvent.press(screen.getByText('Confirm Fund'));

    await waitFor(() => {
      expect(mockInitializeWalletTopUp).toHaveBeenCalledWith({
        amount: 1000,
        customerName: 'Ada Lovelace',
        customerPhone: '08012345678',
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        // Persisted server-side so the wallet-credited push can deep-link
        // back to the interrupted purchase.
        returnTo: '/imei-check',
      });
    });
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/payment-gateway',
      params: expect.objectContaining({
        amount: '1000',
        paymentKind: 'wallet',
        returnTo: '/imei-check',
      }),
    });
  });

  it('syncs wallet top-up state when route params change after mount', async () => {
    const { rerender } = render(<WalletScreen />);

    expect(screen.getByText('show-fund-panel:false')).toBeOnTheScreen();
    expect(screen.getByText('fund-amount:')).toBeOnTheScreen();

    mockSearchParams = {
      action: 'fund',
      requiredAmount: '1750',
      returnTo: '/imei-check',
    };

    rerender(<WalletScreen />);

    await waitFor(() => {
      expect(screen.getByText('show-fund-panel:true')).toBeOnTheScreen();
    });
    expect(screen.getByText('fund-amount:1750')).toBeOnTheScreen();
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil',
    '/safe/../evil',
    '/safe/./evil',
    '/safe%2fevil',
    '/safe%5cevil',
  ])('ignores invalid returnTo value %s when starting a top-up', async (returnTo) => {
    mockSearchParams = {
      action: 'fund',
      requiredAmount: '1000',
      returnTo,
    };

    render(<WalletScreen />);

    fireEvent.press(screen.getByText('Confirm Fund'));

    await waitFor(() => {
      expect(mockInitializeWalletTopUp).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 1000 })
      );
    });
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/payment-gateway',
      params: expect.not.objectContaining({
        returnTo: expect.anything(),
      }),
    });
  });

  it('opens the reward redemption panel from the route action', () => {
    mockSearchParams = { action: 'redeem' };

    render(<WalletScreen />);

    expect(screen.getByText('show-fund-panel:false')).toBeOnTheScreen();
    expect(screen.getByText('show-redeem-panel:true')).toBeOnTheScreen();
  });

  it('blocks invalid wallet top-up amounts before calling the API', () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    render(<WalletScreen />);

    fireEvent.press(screen.getByText('Open Fund Panel'));
    fireEvent.press(screen.getByText('Set Invalid Fund Amount'));
    fireEvent.press(screen.getByText('Confirm Fund'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Invalid Amount',
      'Wallet top-up amount must be between ₦100 and ₦500,000.'
    );
    expect(mockInitializeWalletTopUp).not.toHaveBeenCalled();
  });

  it('blocks invalid loyalty point redemption before hitting the mutation', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    render(<WalletScreen />);

    fireEvent.press(screen.getByText('Open Redeem Panel'));
    fireEvent.press(screen.getByText('Set Invalid Redeem Points'));
    fireEvent.press(screen.getByText('Confirm Redeem'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Invalid Input',
        'Please enter a valid number of points'
      );
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('blocks non-100-point redemption amounts before hitting the mutation', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    render(<WalletScreen />);

    fireEvent.press(screen.getByText('Open Redeem Panel'));
    fireEvent.press(screen.getByText('Set Block Invalid Redeem Points'));
    fireEvent.press(screen.getByText('Confirm Redeem'));

    expect(mockMutateAsync).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Invalid Points',
        'Redeem points in 100-point blocks'
      );
    });
  });

  it('allows higher redemption values and surfaces backend validation errors', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    mockMutateAsync.mockRejectedValueOnce(
      new Error('Insufficient loyalty points')
    );

    render(<WalletScreen />);

    fireEvent.press(screen.getByText('Open Redeem Panel'));
    fireEvent.press(screen.getByText('Set Over Balance Redeem Points'));
    fireEvent.press(screen.getByText('Confirm Redeem'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(2100);
    });
    expect(alertSpy).toHaveBeenCalledWith(
      'Error',
      'Insufficient loyalty points'
    );
  });

  it('tracks and announces successful point redemptions', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    mockMutateAsync.mockResolvedValue({
      conversionRate: 1,
      remainingPoints: 1800,
      walletCredit: 200,
    });

    render(<WalletScreen />);

    fireEvent.press(screen.getByText('Open Redeem Panel'));
    fireEvent.press(screen.getByText('Set Valid Redeem Points'));
    fireEvent.press(screen.getByText('Confirm Redeem'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(200);
    });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'loyalty_redeemed',
      expect.objectContaining({
        customer_id: 'customer-1',
        points_redeemed: 200,
        wallet_credit: 200,
      })
    );
    expect(mockScheduleLocalNotification).toHaveBeenCalledWith(
      'Points Redeemed! 🎁',
      '200 points converted to ₦200 wallet credit.',
      { type: 'loyalty_redemption', points: 200 },
      1
    );
    expect(alertSpy).toHaveBeenCalledWith(
      'Points Redeemed!',
      '200 points converted to ₦200 wallet credit.',
      expect.any(Array)
    );

    const successActions = alertSpy.mock.calls.at(-1)?.[2];
    expect(Array.isArray(successActions)).toBe(true);
    expect(successActions).toHaveLength(1);

    act(() => {
      successActions?.[0]?.onPress?.();
    });

    await waitFor(() => {
      const walletContentProps = mockWalletContent.mock.calls.at(-1)?.[0];
      expect(walletContentProps?.redeemPoints).toBe('');
      expect(walletContentProps?.showRedeemPanel).toBe(false);
    });
  });

  it('reports redeem failures without swallowing the backend message', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    mockMutateAsync.mockRejectedValueOnce(new Error('Redeem failed'));

    render(<WalletScreen />);

    fireEvent.press(screen.getByText('Open Redeem Panel'));
    fireEvent.press(screen.getByText('Set Valid Redeem Points'));
    fireEvent.press(screen.getByText('Confirm Redeem'));

    await waitFor(() => {
      expect(mockTrackError).toHaveBeenCalledWith(
        'loyalty_redemption_failed',
        'Redeem failed',
        expect.objectContaining({
          customer_id: 'customer-1',
          points_attempted: 200,
        })
      );
    });

    expect(alertSpy).toHaveBeenCalledWith('Error', 'Redeem failed');
  });
});
