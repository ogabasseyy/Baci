import { describe, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { useWalletSavingsController } from './use-wallet-savings-controller';
import { WalletScreen } from './WalletScreen';

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
const mockDeriveWalletDisplayData = jest.fn(() => ({
  activeSavingsGoal: mockGoal,
  earningsAvailable: false,
  earningsBalance: 0,
  fundingAccount: null,
  savingsBalance: 0,
  showQuickSave: false,
  spendableBalance: 0,
  totalBalance: 0,
}));

jest.mock('expo-router', () => ({
  Redirect: () => null,
  router: { push: jest.fn() },
  useFocusEffect: jest.fn(),
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
jest.mock('./WalletScreenView', () => ({ WalletScreenView: () => null }));
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

// With PiggyVest off no contribution is stored: the screen hands the savings
// controller an empty id and an empty rail, so the production legacy flow is
// untouched.
describe('server keeps PiggyVest off', () => {
  it('starts with no stored contribution id and no rail', () => {
    render(<WalletScreen />);
    const input = jest.mocked(useWalletSavingsController).mock.calls[0][0];
    expect(input.idempotencyKeyRef.current).toBeNull();
    expect(input.operationRailRef.current).toBeNull();
  });

  it('never marks the primary wallet ready or polls the balance', () => {
    jest.useFakeTimers();
    const refetch = jest.fn();
    mockUseWallet.mockReturnValue({
      data: { wallet: {}, transactions: [] },
      isError: false,
      isLoading: false,
      isRefetching: false,
      refetch,
    });
    render(<WalletScreen />);
    const input = jest.mocked(useWalletSavingsController).mock.calls[0][0];
    expect(input.primaryReady).toBe(false);
    act(() => input.onAddMoney?.());
    act(() => jest.advanceTimersByTime(60_000));
    expect(refetch).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
