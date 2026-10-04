import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { SampleInterestPreview } from './SampleInterestPreview';
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
  useWalletRouteActionSetup: () => false,
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
jest.mock('./use-wallet-savings-actions', () => ({
  createWalletSavingsActions: () => ({
    handleAddSavingsContribution: jest.fn(),
    handleFundSavingsWallet: jest.fn(),
    handleOpenSavings: jest.fn(),
  }),
}));
jest.mock('./use-wallet-savings-amount', () => ({
  useWalletSavingsAmount: () => ['0', jest.fn()],
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

describe('WalletScreen interest preview integration', () => {
  const mockPreview = jest.mocked(SampleInterestPreview);

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRequireAuth.mockReturnValue({ isLoading: false, redirectTo: null });
    mockUseWallet.mockReturnValue({
      data: { wallet: {}, transactions: [] },
      isError: false,
      isLoading: false,
      isRefetching: false,
      refetch: jest.fn(),
    });
    mockUseAuthStore.mockReturnValue(mockAuthState);
    mockDeriveWalletDisplayData.mockReturnValue({
      activeSavingsGoal: mockGoal,
      earningsAvailable: false,
      earningsBalance: 0,
      fundingAccount: null,
      savingsBalance: 0,
      showQuickSave: false,
      spendableBalance: 0,
      totalBalance: 0,
    });
    mockPreview.mockImplementation(({ goal, ownerId }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Preview sample interest"
      >
        <Text>{`${ownerId}|${goal?.title}|${goal?.current_amount}`}</Text>
      </Pressable>
    ));
  });

  it('mounts the explicit preview with the active goal and customer owner', () => {
    render(<WalletScreen />);

    fireEvent.press(
      screen.getByRole('button', { name: 'Preview sample interest' })
    );
    expect(
      screen.getByText('customer-owner-1|Rainy day savings|125000')
    ).toBeTruthy();
    expect(mockPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: mockGoal,
        ownerId: 'customer-owner-1',
        presentation: 'stack',
      }),
      undefined
    );
  });

  it.each([
    ['auth loading', { isLoading: true, redirectTo: null }, undefined],
    ['auth redirect', { isLoading: false, redirectTo: '/login' }, undefined],
    ['unready wallet data', { isLoading: false, redirectTo: null }, null],
  ])('does not mount the preview for %s', (_case, auth, data) => {
    mockUseRequireAuth.mockReturnValue(auth);
    if (data === null) {
      mockUseWallet.mockReturnValue({
        data: null,
        isError: false,
        isLoading: false,
        isRefetching: false,
        refetch: jest.fn(),
      });
    }

    render(<WalletScreen />);

    expect(
      screen.queryByRole('button', { name: 'Preview sample interest' })
    ).toBeNull();
    expect(mockPreview).not.toHaveBeenCalled();
  });
});
