import { act, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import {
  fetchExistingSavingsPlanFunding,
  fetchSavingsPlanFunding,
} from '@/lib/customer-savings';
import type { SavingsPlanFundingResponse } from '@/schemas/customer-savings';
import { WalletSavingsPlanFunding } from './WalletSavingsPlanFunding';

jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
}));
jest.mock('@/lib/savings-card-contributions', () => ({
  getSavingsCardContributionOptions: jest
    .fn()
    .mockRejectedValue(new Error('Unavailable')),
  getSavingsCardContributionStatus: jest.fn(),
  submitSavingsCardContribution: jest.fn(),
}));
jest.mock('@/lib/savings-card-contribution-snapshot', () => ({
  clearTerminalSavingsCardContributionSnapshot: jest.fn(),
  readSavingsCardContributionSnapshot: jest.fn().mockResolvedValue(null),
  saveSavingsCardContributionSnapshot: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'merchant-1', MERCHANT_SLUG: 'savings-synthetic' },
}));
let mockUserId: string | undefined = 'user-1';
let mockMerchantId = 'merchant-1';
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: mockUserId ? { id: mockUserId } : null,
      merchantId: mockMerchantId,
    }),
}));
const goal: WalletActiveSavingsGoal = {
  id: 'goal-1',
  title: 'Phone',
  contribution_amount: 500,
  contribution_frequency: 'weekly',
  current_amount: 100,
  target_amount: 250000,
  maturity_date: '2026-11-01',
  source_mode: 'manual',
  status: 'active',
};
const ready: SavingsPlanFundingResponse = {
  status: 'ready',
  accounts: [
    {
      accountNumber: '0000008907',
      accountName: 'Test plan',
      bankName: 'FAAS (SANDBOX)',
    },
  ],
};

function panel(currentGoal = goal) {
  return (
    <WalletSavingsPlanFunding
      addAmount=""
      colors={Colors.dark}
      goal={currentGoal}
      onAddAmountChange={jest.fn()}
    />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'user-1';
  mockMerchantId = 'merchant-1';
  jest.mocked(fetchExistingSavingsPlanFunding).mockResolvedValue(ready);
});

it('never fetches or shows the goal bank account, only wallet guidance', async () => {
  render(panel());
  await act(async () => {});
  expect(screen.getByText('Add from your wallet')).toBeOnTheScreen();
  expect(screen.queryByText('0000008907')).toBeNull();
  expect(screen.queryByText('FAAS (SANDBOX)')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Copy savings account number' })
  ).toBeNull();
  expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
  expect(fetchSavingsPlanFunding).not.toHaveBeenCalled();
});

it('shows no account note for auto-debit goals', async () => {
  render(panel({ ...goal, source_mode: 'auto_debit' }));
  await act(async () => {});
  expect(screen.queryByText('Add from your wallet')).toBeNull();
  expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
});

it('hides the guidance immediately when the user signs out', async () => {
  const view = render(panel());
  await act(async () => {});
  mockUserId = undefined;
  view.rerender(panel());
  expect(screen.queryByText('Add from your wallet')).toBeNull();
  expect(
    screen.getByText('Sign in to add to this savings plan.')
  ).toBeOnTheScreen();
});
