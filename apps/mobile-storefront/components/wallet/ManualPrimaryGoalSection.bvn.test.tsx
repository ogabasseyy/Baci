import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { ManualPrimaryGoalSection } from './ManualPrimaryGoalSection';
import { resetGoalSetupMemory } from './savings/goal-setup-memory';
import { resetAutoSetupRetries } from './savings/use-auto-retry-setup';

const mockRetry = jest.fn().mockResolvedValue(true);

jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: () => true,
}));
// A stale "BVN required" flag on a stalled setup: the sheet's own path.
jest.mock('./savings/use-savings-plan-funding', () => ({
  useSavingsPlanFunding: () => ({
    planFundingPhase: 'setup_retryable',
    planFundingRequiresBvn: true,
    fetchExistingPlanFunding: jest.fn(),
    failExistingPlanFunding: jest.fn(),
  }),
}));
jest.mock('./savings/use-goal-wallet-setup-poll', () => ({
  useGoalWalletSetupPoll: () => ({
    slow: false,
    paused: false,
    checkAgain: jest.fn(),
  }),
}));
jest.mock('./savings/use-savings-goal-setup', () => ({
  useSavingsGoalSetup: () => ({
    choice: null,
    setChoice: jest.fn(),
    submitting: false,
    attempted: false,
    retried: false,
    error: null,
    submit: jest.fn(),
    retry: mockRetry,
  }),
}));
jest.mock('./WalletSavingsContributionFlow', () => ({
  WalletSavingsContributionFlow: () => null,
}));

const goal: WalletActiveSavingsGoal = {
  contribution_amount: 1000,
  contribution_frequency: 'daily',
  current_amount: 0,
  id: 'goal-a',
  maturity_date: '2027-03-16',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'Phone',
};

beforeEach(() => {
  resetGoalSetupMemory();
  resetAutoSetupRetries();
  mockRetry.mockClear();
});

describe('the Add to savings sheet never shows a BVN field', () => {
  it('so a stale BVN flag cannot stop its automatic setup retry', () => {
    render(
      <ManualPrimaryGoalSection
        addAmount="1000"
        colors={Colors.light}
        goal={goal}
        isAdding={false}
        isFundPending={false}
        merchantId="merchant-a"
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onFundWallet={jest.fn()}
        remainingAmount={250000}
        usesPlanFunding={false}
        userId="customer-a"
        visible
        walletBalance={0}
      />
    );
    // If a BVN field is ever added here, the retry must be gated on it
    // (see SavingsPlanStatusNote: blocked = bvnGate && requiresBvn).
    expect(screen.queryByPlaceholderText(/BVN/)).toBeNull();
    expect(screen.queryByLabelText(/BVN/)).toBeNull();
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });
});
