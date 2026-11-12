import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { ManualPrimaryGoalSection } from './ManualPrimaryGoalSection';

jest.mock('./savings/use-savings-plan-funding', () => ({
  useSavingsPlanFunding: () => ({
    planFundingPhase: 'loading',
    fetchExistingPlanFunding: jest.fn(),
    failExistingPlanFunding: jest.fn(),
  }),
}));
jest.mock('./savings/use-goal-wallet-setup-poll', () => ({
  useGoalWalletSetupPoll: () => ({ exhausted: false, checkAgain: jest.fn() }),
}));
jest.mock('./savings/SavingsPlanStatusNote', () => ({
  SavingsPlanStatusNote: () => null,
}));
jest.mock('./WalletSavingsContributionFlow', () => ({
  WalletSavingsContributionFlow: () => {
    const { Text } = require('react-native');
    return <Text>contribution-actions</Text>;
  },
}));

it('shows the amount form at once while the goal wallet is confirmed in the background', () => {
  const goal: WalletActiveSavingsGoal = {
    contribution_amount: 1000,
    contribution_frequency: 'weekly',
    current_amount: 400,
    id: 'goal-a',
    maturity_date: '2026-12-01',
    source_mode: 'manual',
    status: 'active',
    target_amount: 250000,
    title: 'Phone',
  };
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
      remainingAmount={249600}
      usesPlanFunding={false}
      userId="customer-a"
      visible
      walletBalance={0}
    />
  );

  // No loading panel: the server refuses the transfer until the goal
  // wallet exists, so the form need not wait for that answer.
  expect(screen.queryByText('Almost ready')).toBeNull();
  expect(screen.getByText('contribution-actions')).toBeOnTheScreen();
});
