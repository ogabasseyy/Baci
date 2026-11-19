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
let mockPrimary = false;
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: () => mockPrimary,
}));
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => mockPrimary,
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
  mockPrimary = false;
  jest.mocked(fetchExistingSavingsPlanFunding).mockResolvedValue(ready);
});
const pending: SavingsPlanFundingResponse = { status: 'pending', accounts: [] };

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

describe('sibling notes', () => {
  beforeEach(() => {
    mockPrimary = true;
  });
  const STATUS_COPY = 'Getting your plan ready';

  it('resets both notes on a goal switch without a duplicate-key warning', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.mocked(fetchExistingSavingsPlanFunding).mockResolvedValue(pending);
    const onRefreshWallet = jest
      .fn()
      .mockRejectedValue(new Error('Wallet down'));
    const element = (currentGoal: WalletActiveSavingsGoal) => (
      <WalletSavingsPlanFunding
        addAmount=""
        colors={Colors.dark}
        goal={currentGoal}
        onAddAmountChange={jest.fn()}
        onRefreshWallet={onRefreshWallet}
      />
    );
    const view = render(element(goal));
    await act(async () => {});
    expect(screen.getByText(STATUS_COPY)).toBeOnTheScreen();
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh savings progress' })
    );
    await act(async () => {});
    expect(screen.getByText('Wallet down')).toBeOnTheScreen();

    jest.mocked(fetchExistingSavingsPlanFunding).mockResolvedValue(ready);
    view.rerender(element({ ...goal, id: 'goal-2' }));
    // The wallet note remounted (its error is gone) and the status note
    // remounted and looked up the new goal (now ready, so it is hidden).
    expect(screen.queryByText('Wallet down')).toBeNull();
    await act(async () => {});
    expect(fetchExistingSavingsPlanFunding).toHaveBeenLastCalledWith(
      expect.objectContaining({ goalId: 'goal-2' })
    );
    expect(screen.queryByText(STATUS_COPY)).toBeNull();
    const keyWarnings = errorSpy.mock.calls.filter((call) =>
      String(call[0]).includes('same key')
    );
    expect(keyWarnings).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it('re-reads the goal status after a successful progress refresh', async () => {
    jest.mocked(fetchExistingSavingsPlanFunding).mockResolvedValue(pending);
    render(
      <WalletSavingsPlanFunding
        addAmount=""
        colors={Colors.dark}
        goal={goal}
        onAddAmountChange={jest.fn()}
        onRefreshWallet={jest.fn().mockResolvedValue({ isError: false })}
      />
    );
    await act(async () => {});
    expect(screen.getByText(STATUS_COPY)).toBeOnTheScreen();
    jest.mocked(fetchExistingSavingsPlanFunding).mockResolvedValue(ready);
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh savings progress' })
    );
    await act(async () => {});
    expect(fetchExistingSavingsPlanFunding).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(STATUS_COPY)).toBeNull();
  });
});
