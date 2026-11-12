import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { User } from '@supabase/supabase-js';
import { act, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { useAuthStore } from '@/stores/auth-store';
import type { PrimaryGoalGate } from './savings/use-primary-goal-gate';
import { WalletPrimaryContext } from './WalletPrimaryContext';
import { WalletSavingsFundingSection } from './WalletSavingsFundingSection';

jest.mock('./WalletSavingsContributionFlow', () => ({
  WalletSavingsContributionFlow: () => {
    const { Text } = require('react-native');
    return <Text>wallet-contribution</Text>;
  },
}));
const mockGate = jest.fn((): PrimaryGoalGate => 'checking');
jest.mock('./savings/use-primary-goal-gate', () => ({
  usePrimaryGoalGate: () => mockGate(),
}));
const mockPlanFunding = jest.fn();
jest.mock('./savings/use-savings-plan-funding', () => ({
  useSavingsPlanFunding: () => mockPlanFunding(),
}));
jest.mock('./savings/use-goal-wallet-setup-poll', () => ({
  useGoalWalletSetupPoll: () => ({ exhausted: false, checkAgain: jest.fn() }),
}));
jest.mock('./savings/SavingsPlanStatusNote', () => ({
  SavingsPlanStatusNote: () => null,
}));

const authUser = {
  id: 'user-a',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00.000Z',
} as User;
const goal: WalletActiveSavingsGoal = {
  contribution_amount: 500,
  contribution_frequency: 'weekly',
  current_amount: 0,
  id: 'g1',
  maturity_date: '2026-12-01',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'Phone',
};

function renderSection(walletPrimaryReady: boolean) {
  return render(
    <WalletPrimaryContext.Provider value={walletPrimaryReady}>
      <WalletSavingsFundingSection
        addAmount=""
        colors={Colors.light}
        goal={goal}
        isAdding={false}
        isFundPending={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onFundWallet={jest.fn()}
        remainingAmount={250000}
        usesPlanFunding={false}
        visible
        walletBalance={50000}
      />
    </WalletPrimaryContext.Provider>
  );
}

// Opening Add to savings never waits on a repeat of answers the wallet
// screen already has: the main wallet comes from the screen, and the
// plan's own savings wallet is confirmed in the background.
describe('Add to savings opens without a loading state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGate.mockReturnValue('checking');
    act(() => {
      useAuthStore.setState({ user: authUser, merchantId: 'merchant-1' });
    });
  });

  it.each([
    'idle',
    'loading',
    'ready',
  ])('shows the amount form at once when the wallet already confirmed the main wallet (goal wallet %s)', (phase) => {
    mockPlanFunding.mockReturnValue({
      planFundingPhase: phase,
      fetchExistingPlanFunding: jest.fn(),
      failExistingPlanFunding: jest.fn(),
    });
    renderSection(true);
    expect(screen.queryByText('Almost ready')).toBeNull();
    expect(screen.getByText('wallet-contribution')).toBeOnTheScreen();
  });

  it('still waits when the wallet has not confirmed the main wallet', () => {
    renderSection(false);
    expect(screen.getByText('Almost ready')).toBeOnTheScreen();
    expect(screen.queryByText('wallet-contribution')).toBeNull();
  });
});
