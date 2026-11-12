import { describe, expect, it, jest } from '@jest/globals';
import type { User } from '@supabase/supabase-js';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { useAuthStore } from '@/stores/auth-store';
import type { PrimaryGoalGate } from './savings/use-primary-goal-gate';
import { WalletSavingsFundingSection } from './WalletSavingsFundingSection';

jest.mock('./WalletSavingsContributionFlow', () => ({
  WalletSavingsContributionFlow: () => {
    const { Text } = require('react-native');
    return <Text>wallet-contribution</Text>;
  },
}));
const mockGate = jest.fn(
  (_key?: number, _retryNonce?: number): PrimaryGoalGate => 'off'
);
jest.mock('./savings/use-primary-goal-gate', () => ({
  usePrimaryGoalGate: (key?: number, retryNonce?: number) =>
    mockGate(key, retryNonce),
}));
const mockPlanFunding = jest.fn();
jest.mock('./savings/use-savings-plan-funding', () => ({
  useSavingsPlanFunding: (...args: unknown[]) => mockPlanFunding(...args),
}));
const mockPoll = jest.fn((..._args: unknown[]) => ({
  slow: false,
  checkAgain: jest.fn(),
}));
jest.mock('./savings/use-goal-wallet-setup-poll', () => ({
  useGoalWalletSetupPoll: (...args: unknown[]) => mockPoll(...args),
}));
jest.mock('./savings/SavingsPlanStatusNote', () => ({
  SavingsPlanStatusNote: ({
    funding,
    onCheckAgain,
    slow,
  }: {
    funding?: { planFundingPhase: string };
    onCheckAgain?: () => void;
    slow?: boolean;
  }) => {
    const { Text } = require('react-native');
    return (
      <Text onPress={onCheckAgain}>
        {`status-note:${funding?.planFundingPhase ?? 'own'}${slow ? ':slow' : ''}`}
      </Text>
    );
  },
}));
jest.mock('./WalletSavingsPlanFunding', () => ({
  WalletSavingsPlanFunding: () => {
    const { Text } = require('react-native');
    return <Text>plan-funding</Text>;
  },
}));

const authUser: User = {
  id: 'user-a',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00.000Z',
};
const legacyGateCases: [PrimaryGoalGate, string][] = [
  ['off', 'manual'],
  ['ready', 'auto_debit'],
];

function props(sourceMode: string, over = {}) {
  return {
    addAmount: '',
    colors: Colors.dark,
    goal: {
      contribution_amount: 500,
      contribution_frequency: 'weekly',
      current_amount: 0,
      id: 'g1',
      maturity_date: '2026-12-01',
      source_mode: sourceMode === 'auto_debit' ? 'auto_debit' : 'manual',
      status: 'active',
      target_amount: 1000,
      title: 'Phone',
    } satisfies WalletActiveSavingsGoal,
    isAdding: false,
    isFundPending: false,
    onAddAmountChange: jest.fn(),
    onAddSavings: jest.fn(),
    onFundWallet: jest.fn(),
    remainingAmount: 1000,
    usesPlanFunding: true,
    visible: true,
    walletBalance: 0,
    ...over,
  };
}

describe('WalletSavingsFundingSection', () => {
  beforeEach(() => {
    act(() =>
      useAuthStore.setState({ user: authUser, merchantId: 'merchant-1' })
    );
  });
  it('passes the wallet refresh time to the readiness gate', () => {
    render(
      <WalletSavingsFundingSection
        {...props('manual', { walletUpdatedAt: 1234 })}
      />
    );
    expect(mockGate).toHaveBeenCalledWith(1234, 0);
  });

  it('shows wallet contribution and plan funding for manual plans', () => {
    render(<WalletSavingsFundingSection {...props('manual')} />);
    expect(screen.getByText('wallet-contribution')).toBeOnTheScreen();
    expect(screen.getByText('plan-funding')).toBeOnTheScreen();
  });

  it('shows only plan funding for non-manual plans', () => {
    render(<WalletSavingsFundingSection {...props('auto_debit')} />);
    expect(screen.queryByText('wallet-contribution')).toBeNull();
    expect(screen.getByText('plan-funding')).toBeOnTheScreen();
  });

  it('renders nothing while hidden in plan-funding mode', () => {
    render(
      <WalletSavingsFundingSection {...props('manual', { visible: false })} />
    );
    expect(screen.queryByText('wallet-contribution')).toBeNull();
  });

  it('shows only wallet contribution without plan funding', () => {
    render(
      <WalletSavingsFundingSection
        {...props('manual', { usesPlanFunding: false, visible: false })}
      />
    );
    expect(screen.getByText('wallet-contribution')).toBeOnTheScreen();
    expect(screen.queryByText('plan-funding')).toBeNull();
  });
});

describe('manual goal on a ready primary wallet (plan funding off)', () => {
  const plan = (planFundingPhase: string) => ({
    planFundingPhase,
    fetchExistingPlanFunding: jest.fn(),
  });
  const renderManual = (sourceMode = 'manual') =>
    render(
      <WalletSavingsFundingSection
        {...props(sourceMode, { usesPlanFunding: false })}
      />
    );

  beforeEach(() => {
    jest.clearAllMocks();
    mockGate.mockReturnValue('ready');
    act(() => {
      useAuthStore.setState({ user: authUser, merchantId: 'merchant-1' });
    });
  });

  it('shows the contribution flow only once the goal wallet is ready, with the note above it', () => {
    mockPlanFunding.mockReturnValue(plan('ready'));
    renderManual();
    expect(screen.getByText('status-note:ready')).toBeOnTheScreen();
    expect(screen.getByText('wallet-contribution')).toBeOnTheScreen();
    expect(screen.queryByText('plan-funding')).toBeNull();
  });

  it.each([
    'not_started',
    'pending',
    'setup_retryable',
    'unavailable',
    'error',
  ])('shows only the note, no contribution flow, while the goal wallet is %s', (phase) => {
    mockPlanFunding.mockReturnValue(plan(phase));
    renderManual();
    expect(screen.getByText(`status-note:${phase}`)).toBeOnTheScreen();
    expect(screen.queryByText('wallet-contribution')).toBeNull();
  });

  it("passes the poll's slow flag and check-again to the note", () => {
    mockGate.mockReturnValue('ready');
    const checkAgain = jest.fn();
    mockPlanFunding.mockReturnValue({
      planFundingPhase: 'pending',
      fetchExistingPlanFunding: jest.fn(),
    });
    mockPoll.mockReturnValueOnce({ slow: true, checkAgain });
    renderManual();
    fireEvent.press(screen.getByText('status-note:pending:slow'));
    expect(checkAgain).toHaveBeenCalledTimes(1);
  });

  it('reads one shared status: the hook, the note and the poll use the same instance', () => {
    const shared = plan('pending');
    mockPlanFunding.mockReturnValue(shared);
    renderManual();
    expect(mockPlanFunding).toHaveBeenCalledWith(
      expect.objectContaining({
        goalId: 'g1',
        identityKey: 'user-a',
        activeMerchantId: 'merchant-1',
        loadExisting: true,
        notFoundMeansNotStarted: true,
      })
    );
    expect(mockPoll).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'pending',
        reread: shared.fetchExistingPlanFunding,
      })
    );
  });

  it('keeps the sheet body occupied and exposes no actions while readiness is checking', () => {
    mockGate.mockReturnValue('checking');
    renderManual();
    expect(screen.queryByText('wallet-contribution')).toBeNull();
    expect(screen.getByText('Almost ready')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Checking savings availability')
    ).toBeOnTheScreen();
    expect(screen.queryByText(/status-note/)).toBeNull();
    expect(mockPlanFunding).not.toHaveBeenCalled();
  });

  it('does not fall back to money actions when identity is missing and the gate is off', () => {
    act(() => useAuthStore.setState({ user: null, merchantId: null }));
    mockGate.mockReturnValue('off');
    renderManual();
    expect(screen.getByText('Sign in to add to savings')).toBeOnTheScreen();
    expect(screen.queryByText('wallet-contribution')).toBeNull();
    expect(mockPlanFunding).not.toHaveBeenCalled();
  });

  it('keeps money actions closed after a readiness read error and offers a gate retry', () => {
    mockGate.mockImplementation((_key, retryNonce) =>
      retryNonce ? 'checking' : 'error'
    );
    renderManual();
    expect(
      screen.getByText('We couldn’t confirm your wallet is ready.')
    ).toBeOnTheScreen();
    expect(screen.queryByText('wallet-contribution')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(
      screen.getByLabelText('Checking savings availability')
    ).toBeOnTheScreen();
    expect(mockGate).toHaveBeenLastCalledWith(undefined, 1);
    expect(screen.queryByText('wallet-contribution')).toBeNull();
  });

  it('waits only for an unknown main wallet, never for goal-wallet loading', () => {
    mockGate.mockReturnValue('checking');
    const fundingProps = props('manual', { usesPlanFunding: false });
    const view = render(<WalletSavingsFundingSection {...fundingProps} />);
    expect(screen.getByText('Almost ready')).toBeOnTheScreen();
    expect(screen.queryByText('wallet-contribution')).toBeNull();

    mockGate.mockReturnValue('ready');
    mockPlanFunding.mockReturnValue(plan('loading'));
    view.rerender(
      <WalletSavingsFundingSection {...fundingProps} walletBalance={1} />
    );
    expect(screen.getByText('status-note:loading')).toBeOnTheScreen();
    expect(screen.queryByText('Almost ready')).toBeNull();
    expect(screen.getByText('wallet-contribution')).toBeOnTheScreen();

    mockPlanFunding.mockReturnValue(plan('ready'));
    view.rerender(
      <WalletSavingsFundingSection {...fundingProps} walletBalance={2} />
    );
    expect(screen.getByText('status-note:ready')).toBeOnTheScreen();
    expect(screen.queryByText('Almost ready')).toBeNull();
    expect(screen.getByText('wallet-contribution')).toBeOnTheScreen();
  });

  it.each(
    legacyGateCases
  )("is today's wallet contribution alone for gate %s and a %s goal", (gate, mode) => {
    mockGate.mockReturnValue(gate);
    renderManual(mode);
    expect(screen.getByText('wallet-contribution')).toBeOnTheScreen();
    expect(screen.queryByText(/status-note/)).toBeNull();
    expect(mockPlanFunding).not.toHaveBeenCalled();
  });

  it('leaves the staging plan-funding path untouched whatever the gate says', () => {
    render(<WalletSavingsFundingSection {...props('manual')} />);
    expect(screen.getByText('wallet-contribution')).toBeOnTheScreen();
    expect(screen.getByText('plan-funding')).toBeOnTheScreen();
    expect(screen.queryByText(/status-note/)).toBeNull();
    expect(mockPlanFunding).not.toHaveBeenCalled();
  });
});
