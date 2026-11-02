import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  fetchExistingSavingsPlanFunding,
  fetchSavingsPlanFunding,
} from '@/lib/customer-savings';
import type { SavingsPlanFundingResponse } from '@/schemas/customer-savings';
import { WalletSavingsContributionPreparation } from './WalletSavingsContributionPreparation';

jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
}));
jest.mock('./WalletSavingsPlanFunding', () => ({
  WalletSavingsPlanFunding: () => null,
}));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'merchant-1', MERCHANT_SLUG: 'synthetic' },
}));
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: () => true,
}));
let mockCapability: boolean | null = true;
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => mockCapability,
}));
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => true,
  isHostedStagingWalletTopUpBlocked: () => true,
}));
let mockUserId: string | undefined = 'user-1';
let mockMerchantId = 'merchant-1';
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        user: mockUserId ? { id: mockUserId } : null,
        merchantId: mockMerchantId,
      }),
    {
      getState: () => ({
        user: mockUserId ? { id: mockUserId } : null,
        merchantId: mockMerchantId,
      }),
    }
  ),
}));

const ready: SavingsPlanFundingResponse = {
  status: 'ready',
  accounts: [
    {
      accountNumber: '0000008907',
      accountName: 'Synthetic',
      bankName: 'Test bank',
    },
  ],
};
const missing = Object.assign(
  new Error('Savings wallet setup has not started.'),
  { code: 'SAVINGS_WALLET_NOT_FOUND' }
);
const props = {
  goal: {
    id: 'goal-1',
    title: 'Phone',
    status: 'active' as const,
    source_mode: 'manual' as const,
    current_amount: 0,
    target_amount: 1000,
    contribution_amount: 100,
    contribution_frequency: 'weekly' as const,
    maturity_date: '2026-12-01',
  },
  addAmount: '100',
  colors: Colors.dark,
  isAdding: false,
  isFundPending: false,
  onAddAmountChange: jest.fn(),
  onAddSavings: jest.fn(),
  onFundWallet: jest.fn(),
  remainingAmount: 1000,
  walletBalance: 100,
  hasPendingContribution: false,
  canAdd: true,
  usesPlanFunding: false,
  usesWalletBankTransfer: true,
  visible: true,
};
const recover = jest.mocked(fetchExistingSavingsPlanFunding);
const provision = jest.mocked(fetchSavingsPlanFunding);
const confirm = () =>
  screen.queryByRole('button', { name: 'Confirm savings top-up' });
const prepare = () => screen.getByRole('button', { name: 'Show plan account' });
const check = () =>
  screen.getByRole('button', { name: 'Check account status' });

beforeEach(() => {
  jest.resetAllMocks();
  mockUserId = 'user-1';
  mockMerchantId = 'merchant-1';
  mockCapability = true;
  recover.mockRejectedValue(missing);
  provision.mockResolvedValue(ready);
});

it('allows a new preparation only after the server confirms the wallet is still missing', async () => {
  provision
    .mockRejectedValueOnce(new Error('Network unavailable'))
    .mockResolvedValueOnce(ready);
  render(<WalletSavingsContributionPreparation goalId="goal-1" {...props} />);
  await act(async () => {});

  fireEvent.press(prepare());
  await act(async () => {});
  expect(check()).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: 'Show plan account' })
  ).toBeNull();
  fireEvent.press(check());
  await act(async () => {});
  expect(prepare()).toBeEnabled();
  fireEvent.press(prepare());
  await act(async () => {});

  expect(provision).toHaveBeenCalledTimes(2);
  expect(confirm()).toBeEnabled();
});

it('keeps preparation status-only after an unknown error', async () => {
  provision.mockRejectedValueOnce(new Error('Network unavailable'));
  render(<WalletSavingsContributionPreparation goalId="goal-1" {...props} />);
  await act(async () => {});

  fireEvent.press(prepare());
  await act(async () => {});

  expect(check()).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: 'Show plan account' })
  ).toBeNull();
  recover.mockResolvedValueOnce({ status: 'pending' });
  fireEvent.press(check());
  await act(async () => {});
  expect(provision).toHaveBeenCalledTimes(1);
});

it('checks authoritative status before retrying a not-found preparation response', async () => {
  provision.mockRejectedValueOnce(missing);
  render(<WalletSavingsContributionPreparation goalId="goal-1" {...props} />);
  await act(async () => {});
  fireEvent.press(prepare());
  await act(async () => {});
  expect(check()).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: 'Show plan account' })
  ).toBeNull();
  expect(provision).toHaveBeenCalledTimes(1);
});

it('does not duplicate preparation on rapid repeated presses', async () => {
  provision.mockImplementationOnce(() => new Promise(() => {}));
  render(<WalletSavingsContributionPreparation goalId="goal-1" {...props} />);
  await act(async () => {});
  const button = prepare();
  fireEvent.press(button);
  fireEvent.press(button);
  expect(provision).toHaveBeenCalledTimes(1);
});

it('keeps preparation status-only while the server reports pending', async () => {
  provision.mockResolvedValueOnce({ status: 'pending' });
  render(<WalletSavingsContributionPreparation goalId="goal-1" {...props} />);
  await act(async () => {});

  fireEvent.press(prepare());
  await act(async () => {});

  expect(check()).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: 'Show plan account' })
  ).toBeNull();
  fireEvent.press(check());
  await act(async () => {});
  expect(provision).toHaveBeenCalledTimes(1);
});
