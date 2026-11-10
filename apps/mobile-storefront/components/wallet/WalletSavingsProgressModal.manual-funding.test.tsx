import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { fetchExistingSavingsPlanFunding } from '@/lib/customer-savings';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';

const mockFetchJson = jest.fn();
jest.mock('@/lib/storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));
jest.mock('@/lib/savings-first-card-browser', () => ({
  openSavingsFirstCardBrowser: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => '00000000-0000-4000-8000-000000000099',
}));
jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
}));
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => true,
  isHostedStagingWalletTopUpBlocked: () => false,
}));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'merchant-1', MERCHANT_SLUG: 'savings-synthetic' },
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { id: 'user-1' }, merchantId: 'merchant-1' }),
}));

const goal: WalletActiveSavingsGoal = {
  contribution_amount: 500,
  contribution_frequency: 'weekly',
  current_amount: 100,
  id: '00000000-0000-4000-8000-000000000001',
  maturity_date: '2026-11-01',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'My next phone',
};
const onFundWallet = jest.fn();
const onAddSavings = jest.fn();

function modal(
  currentGoal = goal,
  visible = true,
  onRefreshWallet?: () => Promise<unknown>,
  addAmount = '',
  walletBalance = 0
) {
  return (
    <WalletSavingsProgressModal
      addAmount={addAmount}
      colors={Colors.dark}
      goal={currentGoal}
      isAdding={false}
      onAddAmountChange={jest.fn()}
      onAddSavings={onAddSavings}
      onChangeDevice={jest.fn()}
      onClose={jest.fn()}
      onFundWallet={onFundWallet}
      onRefreshWallet={onRefreshWallet}
      visible={visible}
      walletBalance={walletBalance}
    />
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockFetchJson
    .mockReset()
    .mockRejectedValue(new Error('Card routes disabled'));
  jest.mocked(fetchExistingSavingsPlanFunding).mockResolvedValue({
    status: 'ready',
    accounts: [
      {
        accountName: 'Test plan',
        accountNumber: '0000008907',
        bankName: 'FAAS (SANDBOX)',
      },
    ],
  });
});

it('lets a manual plan with a funded wallet contribute from the wallet', async () => {
  render(modal(goal, true, undefined, '500', 1000));
  await act(async () => {});
  fireEvent.press(
    screen.getByRole('button', { name: 'Confirm savings top-up' })
  );
  expect(onAddSavings).toHaveBeenCalledTimes(1);
  expect(onFundWallet).not.toHaveBeenCalled();
  expect(screen.queryByText('0000008907')).toBeNull();
});

it('offers wallet funding, not bank transfer details, for a manual plan with an empty wallet', async () => {
  render(modal(goal, true, undefined, '500', 0));
  await act(async () => {});
  expect(screen.queryByText(/bank transfer details/i)).toBeNull();
  expect(screen.queryByText(/plan transfer details/i)).toBeNull();
  fireEvent.press(
    screen.getByRole('button', { name: 'Add money for savings' })
  );
  expect(onFundWallet).toHaveBeenCalledTimes(1);
});

it('offers no wallet contribution for an auto-debit plan', async () => {
  render(
    modal({ ...goal, source_mode: 'auto_debit' }, true, undefined, '500', 1000)
  );
  await act(async () => {});
  expect(screen.queryByLabelText('Savings top-up amount')).toBeNull();
});
