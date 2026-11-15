import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { ManualPrimaryGoalSection } from './ManualPrimaryGoalSection';
import {
  rememberGoalSetupPhase,
  resetGoalSetupMemory,
} from './savings/goal-setup-memory';
import type { SavingsPlanFundingPhase } from './savings/use-savings-plan-funding';

let mockPhase: SavingsPlanFundingPhase = 'loading';
const mockStatusNote = jest.fn();

jest.mock('./savings/use-savings-plan-funding', () => ({
  useSavingsPlanFunding: () => ({
    planFundingPhase: mockPhase,
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
jest.mock('./savings/SavingsPlanStatusNote', () => ({
  SavingsPlanStatusNote: (props: { funding: { planFundingPhase: string } }) => {
    mockStatusNote(props.funding.planFundingPhase);
    return null;
  },
}));
jest.mock('./WalletSavingsContributionFlow', () => ({
  WalletSavingsContributionFlow: () => {
    const { Text } = require('react-native');
    return <Text>contribution-actions</Text>;
  },
}));

const goal: WalletActiveSavingsGoal = {
  contribution_amount: 1000,
  contribution_frequency: 'weekly',
  current_amount: 0,
  id: 'goal-a',
  maturity_date: '2026-12-01',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'Phone',
};
const scopeKey = JSON.stringify(['customer-a', 'merchant-a', 'goal-a']);

function renderSection() {
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
}

beforeEach(() => {
  resetGoalSetupMemory();
  mockStatusNote.mockClear();
  mockPhase = 'loading';
});

describe('bugfix: the amount entry flashed while the plan status loaded', () => {
  it('shows a quiet placeholder, not the amount entry, on a first status read', () => {
    renderSection();
    expect(screen.queryByText('contribution-actions')).toBeNull();
    expect(screen.getByText('Almost ready')).toBeOnTheScreen();
  });

  it('keeps a plan last seen getting ready on that card while re-reading', () => {
    rememberGoalSetupPhase(scopeKey, 'pending');
    renderSection();
    expect(screen.queryByText('contribution-actions')).toBeNull();
    expect(screen.queryByText('Almost ready')).toBeNull();
    expect(mockStatusNote).toHaveBeenLastCalledWith('pending');
  });

  it('never re-runs setup on stale news: a stalled plan shows as getting ready', () => {
    rememberGoalSetupPhase(scopeKey, 'setup_retryable');
    renderSection();
    expect(mockStatusNote).toHaveBeenLastCalledWith('pending');
  });
});

it('passes a stalled setup through as it is, so the note can restart it', () => {
  rememberGoalSetupPhase(scopeKey, 'pending');
  mockPhase = 'setup_retryable';
  renderSection();
  expect(mockStatusNote).toHaveBeenLastCalledWith('setup_retryable');
});

it('shows the amount entry at once for a plan last seen ready', () => {
  rememberGoalSetupPhase(scopeKey, 'ready');
  renderSection();
  expect(screen.getByText('contribution-actions')).toBeOnTheScreen();
});

it('shows the amount entry once the status read says ready', () => {
  mockPhase = 'ready';
  renderSection();
  expect(screen.getByText('contribution-actions')).toBeOnTheScreen();
});

it('shows no amount entry for a plan still being set up', () => {
  mockPhase = 'pending';
  renderSection();
  expect(screen.queryByText('contribution-actions')).toBeNull();
});
