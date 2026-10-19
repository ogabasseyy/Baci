import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { fetchExistingSavingsPlanFunding } from '@/lib/customer-savings';
import { openSavingsFirstCardBrowser } from '@/lib/savings-first-card-browser';
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
  onRefreshWallet?: () => Promise<unknown>
) {
  return (
    <WalletSavingsProgressModal
      addAmount=""
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
      walletBalance={0}
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

it('shows the plan account with no amount and an empty ordinary wallet', async () => {
  render(modal());
  await act(async () => {});
  expect(screen.getByText('0000008907')).toBeOnTheScreen();
  expect(screen.getByText('FAAS (SANDBOX)')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Savings top-up amount')).toBeNull();
  expect(screen.queryByText(/Available in wallet/)).toBeNull();
  expect(onFundWallet).not.toHaveBeenCalled();
  expect(onAddSavings).not.toHaveBeenCalled();
});

it('does not turn the bank-transfer action into an old-wallet top-up', async () => {
  render(modal());
  await act(async () => {});
  fireEvent.press(
    screen.getByRole('button', { name: 'Refresh savings account' })
  );
  await act(async () => {});
  expect(fetchExistingSavingsPlanFunding).toHaveBeenCalledTimes(2);
  expect(onFundWallet).not.toHaveBeenCalled();
  expect(onAddSavings).not.toHaveBeenCalled();
});

it('refreshes wallet goal progress when the transfer account is refreshed', async () => {
  const refreshWallet = jest.fn(async () => ({ isError: false }));
  render(modal(goal, true, refreshWallet));
  await act(async () => {});

  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh savings account' })
    );
    await Promise.resolve();
  });

  expect(fetchExistingSavingsPlanFunding).toHaveBeenCalledTimes(2);
  expect(refreshWallet).toHaveBeenCalledTimes(1);
});

it('shows a failed wallet refresh without claiming the transfer was received', async () => {
  const refreshWallet = jest.fn(async () => ({
    isError: true,
    error: new Error('Wallet refresh failed'),
  }));
  render(modal(goal, true, refreshWallet));
  await act(async () => {});

  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh savings account' })
    );
    await Promise.resolve();
  });

  expect(screen.getByText('Wallet refresh failed')).toBeOnTheScreen();
  expect(screen.queryByText(/transfer received|funding confirmed/i)).toBeNull();
});

it('shows an error when the parent wallet refresh rejects', async () => {
  const refreshWallet = jest.fn(async () => {
    throw new Error('Wallet refresh rejected');
  });
  render(modal(goal, true, refreshWallet));
  await act(async () => {});

  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh savings account' })
    );
    await Promise.resolve();
  });

  expect(screen.getByText('Wallet refresh rejected')).toBeOnTheScreen();
});

it('omits unavailable extra-contribution forms without changing the auto-debit schedule', async () => {
  render(modal({ ...goal, source_mode: 'auto_debit' }));
  await act(async () => {});
  expect(screen.queryByLabelText('Card contribution amount')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Pay by card' })).toBeNull();
  expect(
    screen.queryByText('Card contributions are unavailable right now.')
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Review card contribution' })
  ).toBeNull();
  expect(screen.queryByLabelText('New card contribution amount')).toBeNull();
  expect(openSavingsFirstCardBrowser).not.toHaveBeenCalled();
  expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
});

it.each([
  'manual',
  'auto_debit',
] as const)('launches first-card checkout for %s without enabling saved-card routes', async (sourceMode) => {
  const checkoutPath = '/api/storefront/customer/savings/card-checkout';
  const state = {
    goalId: goal.id,
    intentId: '00000000-0000-4000-8000-000000000003',
    amountKobo: 10000,
    currency: 'NGN',
  };
  const authorizationUrl = 'https://checkout.paystack.com/synthetic123';
  mockFetchJson.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) => {
      if (!path.startsWith(checkoutPath))
        throw new Error('Saved-card route disabled');
      if (method === 'POST')
        return { ...state, status: 'ready', authorizationUrl };
      if (method === 'PATCH') return { ...state, status: 'pending' };
      return {
        goalId: goal.id,
        enabled: true,
        maximumAmountKobo: 10000,
        currency: 'NGN',
      };
    }
  );
  render(modal({ ...goal, source_mode: sourceMode }));
  await act(async () => {});
  expect(screen.queryByLabelText('Card contribution amount')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Review new card contribution' })
  ).toBeDisabled();
  fireEvent.changeText(
    screen.getByLabelText('New card contribution amount'),
    '100.01'
  );
  expect(
    screen.getByRole('button', { name: 'Review new card contribution' })
  ).toBeDisabled();
  fireEvent.changeText(
    screen.getByLabelText('New card contribution amount'),
    '100'
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Review new card contribution' })
  );
  expect(
    screen.getByText(/Saving this card does not enable automatic payments/)
  ).toBeOnTheScreen();
  expect(mockFetchJson.mock.calls.every(([request]) => !request.method)).toBe(
    true
  );
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Confirm one-time new card charge ₦100.00',
      })
    );
  });
  expect(mockFetchJson).toHaveBeenCalledWith(
    expect.objectContaining({
      path: checkoutPath,
      method: 'POST',
      includeCsrf: true,
      body: {
        goalId: goal.id,
        amountKobo: 10000,
        idempotencyKey: '00000000-0000-4000-8000-000000000099',
        consent: {
          version: 'prefunded-first-card-v1',
          oneTimeCharge: true,
          saveCard: true,
        },
      },
    })
  );
  expect(openSavingsFirstCardBrowser).toHaveBeenCalledWith(authorizationUrl);
  expect(
    mockFetchJson.mock.calls.filter(([request]) => request.method === 'POST')
  ).toHaveLength(1);
  expect(mockFetchJson).toHaveBeenCalledWith(
    expect.objectContaining({
      path: checkoutPath,
      method: 'PATCH',
      includeCsrf: true,
      body: { intentId: state.intentId, goalId: goal.id },
    })
  );
  expect(screen.queryByText(/Payment confirmed for/)).toBeNull();
  expect(onFundWallet).not.toHaveBeenCalled();
  expect(onAddSavings).not.toHaveBeenCalled();
});

it('hides first-card launch when its server capability is disabled', async () => {
  mockFetchJson.mockResolvedValue({
    goalId: goal.id,
    enabled: false,
    maximumAmountKobo: 0,
    currency: 'NGN',
  });
  render(modal({ ...goal, source_mode: 'auto_debit' }));
  await act(async () => {});
  expect(screen.queryByLabelText('New card contribution amount')).toBeNull();
  expect(openSavingsFirstCardBrowser).not.toHaveBeenCalled();
});

it.each([
  false,
  true,
])('does not load funding for a completed plan (visible=%s)', (visible) => {
  render(modal({ ...goal, status: 'completed' }, visible));
  expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
});

it('does not fetch an account while the sheet is closed', () => {
  render(modal(goal, false));
  expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
});
