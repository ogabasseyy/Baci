import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { useWalletSavingsController } from './use-wallet-savings-controller';
import { WalletScreen } from './WalletScreen';
import { WalletScreenView } from './WalletScreenView';

const mockGoal: WalletActiveSavingsGoal = {
  contribution_amount: 5000,
  contribution_frequency: 'weekly',
  current_amount: 125000,
  id: 'goal-active-1',
  maturity_date: '2027-01-01',
  source_mode: 'manual',
  status: 'active',
  target_amount: 500000,
  title: 'Rainy day savings',
};
const mockAuthState = {
  customer: { id: 'customer-owner-1', phone: '08000000000' },
  merchantId: 'merchant-1',
  updateProfile: jest.fn(),
  user: { id: 'auth-user-1' },
};
const mockUseRequireAuth = jest.fn(() => ({
  isLoading: false,
  redirectTo: null as string | null,
}));
const mockUseWallet = jest.fn(() => ({
  data: { wallet: {}, transactions: [] as unknown[] } as {
    wallet: Record<string, unknown>;
    transactions: unknown[];
  } | null,
  isError: false,
  isLoading: false,
  isRefetching: false,
  refetch: jest.fn(),
}));
const mockUseAuthStore = jest.fn(() => mockAuthState);
const mockSetSavingsAmount = jest.fn();
const mockDeriveWalletDisplayData = jest.fn<() => Record<string, unknown>>(
  () => ({
    activeSavingsGoal: mockGoal,
    earningsAvailable: false,
    earningsBalance: 0,
    fundingAccount: null,
    savingsBalance: 0,
    showQuickSave: false,
    walletBalance: 0,
    totalBalance: 0,
  })
);

jest.mock('expo-router', () => ({
  Redirect: () => null,
  router: { push: jest.fn() },
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()) }),
}));
jest.mock('zustand/react/shallow', () => ({
  useShallow: (selector: unknown) => selector,
}));
jest.mock('@/components/wallet/use-wallet-balance-contract-warning', () => ({
  useWalletBalanceContractWarning: jest.fn(),
}));
jest.mock('@/components/wallet/use-wallet-funding-account-controller', () => ({
  useWalletFundingAccountController: () => ({
    canCreateFundingAccount: false,
    createFundingAccountUnavailableMessage: null,
    needsPhone: false,
    onCreateFundingAccount: jest.fn(),
    onSubmitPhone: jest.fn(),
  }),
}));
jest.mock('@/components/wallet/use-wallet-route-action-setup', () => ({
  useWalletRouteActionSetup: jest.fn(() => false),
}));
jest.mock('@/hooks/use-auth-guard', () => ({
  useRequireAuth: () => mockUseRequireAuth(),
}));
jest.mock('@/hooks/use-wallet', () => ({
  useCreateWalletFundingAccount: () => ({
    isPending: false,
    mutateAsync: jest.fn(),
  }),
  useRedeemPoints: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useWallet: () => mockUseWallet(),
}));
jest.mock('@/hooks/useMerchantPaymentSettings', () => ({
  useMerchantPaymentSettings: () => ({
    data: null,
    isError: false,
    isPending: false,
  }),
}));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'merchant-1', MERCHANT_SLUG: 'merchant' },
}));
jest.mock('@/lib/pick-merchant-id', () => ({
  pickMerchantId: () => 'merchant-1',
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: () => mockUseAuthStore(),
}));
jest.mock('./SampleInterestPreview', () => ({
  SampleInterestPreview: jest.fn(() => null),
}));
jest.mock('./WalletScreenView', () => ({
  WalletScreenView: jest.fn(() => null),
}));
jest.mock('./use-wallet-appearance', () => ({
  useWalletAppearance: () => ({ colors: {}, scrollContentStyle: {} }),
}));
jest.mock('./use-wallet-saved-cards', () => ({
  useWalletSavedCards: () => false,
}));
jest.mock('./use-wallet-savings-controller', () => ({
  useWalletSavingsController: jest.fn(() => ({
    handleAddSavingsContribution: jest.fn(),
    handleFundSavingsWallet: jest.fn(),
    handleOpenSavings: jest.fn(),
  })),
}));
jest.mock('./use-wallet-savings-amount', () => ({
  useWalletSavingsAmount: () => ['500', mockSetSavingsAmount],
}));
jest.mock('./wallet-screen.handlers', () => ({
  fundWallet: jest.fn(),
  redeemWalletPoints: jest.fn(),
}));
jest.mock('./wallet-screen.helpers', () => ({
  deriveWalletDisplayData: () => mockDeriveWalletDisplayData(),
  getWalletLoadingMessage: () => 'Wallet loading',
  sanitizeWalletFundAmount: (value: string) => value,
}));
jest.mock('./wallet-screen-savings.handlers', () => ({
  changeSavingsGoalDevice: jest.fn(),
  createSavingsVariantResolutionHandler: () => jest.fn(),
}));

describe('WalletScreen PiggyVest main wallet', () => {
  const primaryDisplay = () => ({
    activeSavingsGoal: mockGoal,
    earningsAvailable: false,
    earningsBalance: 0,
    fundingAccount: null,
    primaryReady: true,
    savingsPrimary: true,
    savingsBalance: 0,
    showQuickSave: false,
    walletBalance: 1234.56,
    totalBalance: 1234.56,
  });

  function mountWith(primaryReady: boolean) {
    const refetch = jest.fn();
    mockUseWallet.mockReturnValue({
      data: {
        wallet: primaryReady ? { primary_balance_kobo: 123456 } : {},
        transactions: [],
      },
      isError: false,
      isLoading: false,
      isRefetching: false,
      refetch,
    });
    mockDeriveWalletDisplayData.mockReturnValue(
      primaryReady
        ? primaryDisplay()
        : {
            ...primaryDisplay(),
            primaryReady: false,
            savingsPrimary: undefined,
            walletBalance: 5000,
          }
    );
    render(<WalletScreen />);
    const controller = () =>
      jest.mocked(useWalletSavingsController).mock.calls.at(-1)?.[0];
    const contentProps = () =>
      jest.mocked(WalletScreenView).mock.calls.at(-1)?.[0].walletContentProps;
    return { controller, contentProps, refetch };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockUseRequireAuth.mockReturnValue({ isLoading: false, redirectTo: null });
    mockUseAuthStore.mockReturnValue(mockAuthState);
  });

  it('funds savings from the PiggyVest balance and routes a short balance to Add money', () => {
    const { controller, contentProps } = mountWith(true);

    expect(controller()?.walletBalance).toBe(1234.56);
    expect(controller()?.primaryReady).toBe(true);
    expect(contentProps()?.primaryReady).toBe(true);
    expect(contentProps()?.showFundPanel).toBe(false);

    act(() => controller()?.onAddMoney?.());

    expect(contentProps()?.showFundPanel).toBe(true);
    expect(contentProps()?.showSavingsProgress).toBe(false);
  });

  it('polls the balance every 10 seconds while the fund panel is open', async () => {
    const { controller, refetch } = mountWith(true);
    act(() => jest.advanceTimersByTime(30_000));
    expect(refetch).not.toHaveBeenCalled();

    act(() => controller()?.onAddMoney?.());
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });
    }

    expect(refetch).toHaveBeenCalledTimes(3);
  });

  it("keeps today's behaviour on the legacy wallet", () => {
    const { controller, contentProps, refetch } = mountWith(false);

    expect(controller()?.primaryReady).toBe(false);
    expect(contentProps()?.primaryReady).toBe(false);
    act(() => controller()?.onAddMoney?.());
    act(() => jest.advanceTimersByTime(60_000));
    expect(refetch).not.toHaveBeenCalled();
  });
});
