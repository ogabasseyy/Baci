import { act, fireEvent, render, screen } from '@testing-library/react-native';
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
  getSavingsCardContributionOptions: jest.fn().mockRejectedValue(new Error('Unavailable')),
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

it('retrieves the existing plan account, never creating or funding one on open', async () => {
  render(panel());
  await act(async () => {});
  expect(screen.getByText('0000008907')).toBeOnTheScreen();
  expect(fetchExistingSavingsPlanFunding).toHaveBeenCalledWith({
    goalId: goal.id,
    merchantId: 'merchant-1',
    merchantSlug: 'savings-synthetic',
  });
  expect(fetchSavingsPlanFunding).not.toHaveBeenCalled();
});

it('retries the read after a network failure', async () => {
  jest
    .mocked(fetchExistingSavingsPlanFunding)
    .mockRejectedValueOnce(new Error('Network unavailable'));
  render(panel());
  await act(async () => {});
  expect(screen.getByText('Network unavailable')).toBeOnTheScreen();
  fireEvent.press(
    screen.getByRole('button', { name: 'Refresh savings account' })
  );
  await act(async () => {});
  expect(screen.getByText('0000008907')).toBeOnTheScreen();
});

it.each([
  'user',
  'merchant',
  'goal',
] as const)('discards a late account response when the %s changes', async (scope) => {
  let complete: (response: SavingsPlanFundingResponse) => void = () =>
    undefined;
  jest.mocked(fetchExistingSavingsPlanFunding).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  jest
    .mocked(fetchExistingSavingsPlanFunding)
    .mockResolvedValue({ status: 'pending' });
  const view = render(panel());
  if (scope === 'user') mockUserId = 'user-2';
  if (scope === 'merchant') mockMerchantId = 'merchant-2';
  view.rerender(panel(scope === 'goal' ? { ...goal, id: 'goal-2' } : goal));
  await act(async () => {
    complete(ready);
  });
  expect(screen.queryByText('0000008907')).toBeNull();
});

it('hides the account immediately when the user signs out', async () => {
  const view = render(panel());
  await act(async () => {});
  mockUserId = undefined;
  view.rerender(panel());
  expect(screen.queryByText('0000008907')).toBeNull();
  expect(
    screen.getByText('Sign in to add to this savings plan.')
  ).toBeOnTheScreen();
});
