import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';

// The pilot merchant: primary-routed without any probe.
const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const GOAL_ID = '00000000-0000-4000-8000-000000000001';

const mockFetchJson = jest.fn();
jest.mock('@/lib/storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({
    fetchJson: mockFetchJson,
    buildMerchantIdentifiers: () => ({}),
  }),
}));
jest.mock('@/lib/piggyvest-primary-wallet');
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  ...jest.requireActual('@/lib/piggyvest-primary-capability'),
  usePiggyvestPrimaryCapability: () => true,
}));
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => false,
  isHostedStagingWalletTopUpBlocked: () => false,
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: jest.fn(),
}));

const goal: WalletActiveSavingsGoal = {
  contribution_amount: 500,
  contribution_frequency: 'weekly',
  current_amount: 100,
  id: GOAL_ID,
  maturity_date: '2999-01-01',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'My next phone',
};
const account = {
  accountNumber: '0123456789',
  accountName: 'Goal wallet',
  bankName: 'PiggyVest',
};
const SETUP = '/api/storefront/customer/savings/primary-provisioning/setup';
const STATUS = '/api/storefront/customer/savings/primary-provisioning';
const notFound = () =>
  Object.assign(new Error('not set up'), { code: 'SAVINGS_WALLET_NOT_FOUND' });
const reply = (status: 'pending' | 'ready') => ({
  goalId: GOAL_ID,
  status,
  ...(status === 'ready' ? { accounts: [account] } : {}),
});
const calls = (method: string, path: string) =>
  mockFetchJson.mock.calls
    .map(([call]) => call)
    .filter((call) => call.method === method && call.path === path);

function renderModal() {
  render(
    <WalletSavingsProgressModal
      addAmount=""
      colors={Colors.light}
      goal={goal}
      isAdding={false}
      onAddAmountChange={jest.fn()}
      onAddSavings={jest.fn()}
      onChangeDevice={jest.fn()}
      onClose={jest.fn()}
      onFundWallet={jest.fn()}
      visible
      walletBalance={0}
    />
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  jest.mocked(piggyvestPrimaryWalletApi.read).mockResolvedValue({
    account: { account_number: '1' } as never,
    requiresConsent: false,
    provisioningStatus: 'ready',
  });
  act(() => {
    useAuthStore.setState({
      user: { id: 'user-a' } as never,
      merchantId: MERCHANT,
    });
  });
});
afterEach(() => jest.useRealTimers());

it("asks the interest question for a ready customer's never-set-up goal, sets it up once, polls until ready, then offers the amount field", async () => {
  const statusAnswers = [
    () => Promise.reject(notFound()),
    () => Promise.resolve(reply('pending')),
    () => Promise.resolve(reply('pending')),
    () => Promise.resolve(reply('ready')),
  ];
  mockFetchJson.mockImplementation(
    (call: { method?: string; path: string }) => {
      if (call.path === SETUP) return Promise.resolve(reply('pending'));
      if (call.path === STATUS)
        return (statusAnswers.shift() ?? statusAnswers[0])();
      return Promise.reject(new Error(`unexpected ${call.path}`));
    }
  );
  renderModal();

  expect(
    await screen.findByText('Earn interest on this goal?')
  ).toBeOnTheScreen();
  const yes = screen.getByRole('radio', { name: 'Yes, earn interest' });
  const no = screen.getByRole('radio', { name: 'No, do not earn interest' });
  expect(yes.props.accessibilityState.checked).toBe(false);
  expect(no.props.accessibilityState.checked).toBe(false);
  const submit = screen.getByRole('button', { name: 'Set up this goal' });
  expect(submit.props.accessibilityState.disabled).toBe(true);
  // No contribution can be attempted into an unprovisioned goal.
  expect(screen.queryByLabelText('Savings top-up amount')).toBeNull();
  expect(calls('POST', SETUP)).toHaveLength(0);

  fireEvent.press(yes);
  fireEvent.press(screen.getByRole('button', { name: 'Set up this goal' }));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });

  expect(calls('POST', SETUP)).toHaveLength(1);
  expect(calls('POST', SETUP)[0].body).toEqual({
    merchantId: MERCHANT,
    goalId: GOAL_ID,
    interestAccepted: true,
  });
  expect(screen.queryByLabelText('Savings top-up amount')).toBeNull();

  // Still pending: the status is re-read every 5 seconds until it is ready.
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
  }
  expect(calls('PATCH', STATUS).length).toBeGreaterThanOrEqual(3);
  expect(
    await screen.findByLabelText('Savings top-up amount')
  ).toBeOnTheScreen();
  expect(screen.queryByText('Earn interest on this goal?')).toBeNull();
  expect(calls('POST', SETUP)).toHaveLength(1);
});
