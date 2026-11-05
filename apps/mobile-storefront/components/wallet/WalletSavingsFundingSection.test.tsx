import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { useAuthStore } from '@/stores/auth-store';
import { WalletSavingsFundingSection } from './WalletSavingsFundingSection';

jest.mock('./WalletSavingsContributionFlow', () => ({
  WalletSavingsContributionFlow: () => {
    const { Text } = require('react-native');
    return <Text>wallet-contribution</Text>;
  },
}));
const mockGate = jest.fn((_key?: number) => 'off');
jest.mock('./savings/use-primary-goal-gate', () => ({
  usePrimaryGoalGate: (key?: number) => mockGate(key),
}));
const mockPlanFunding = jest.fn();
jest.mock('./savings/use-savings-plan-funding', () => ({
  useSavingsPlanFunding: (...args: unknown[]) => mockPlanFunding(...args),
}));
const mockPoll = jest.fn((..._args: unknown[]) => ({
  exhausted: false,
  checkAgain: jest.fn(),
}));
jest.mock('./savings/use-goal-wallet-setup-poll', () => ({
  useGoalWalletSetupPoll: (...args: unknown[]) => mockPoll(...args),
}));
jest.mock('./savings/SavingsPlanStatusNote', () => ({
  SavingsPlanStatusNote: ({
    funding,
    onCheckAgain,
  }: {
    funding?: { planFundingPhase: string };
    onCheckAgain?: () => void;
  }) => {
    const { Text } = require('react-native');
    return (
      <Text onPress={onCheckAgain}>
        {`status-note:${funding?.planFundingPhase ?? 'own'}${onCheckAgain ? ':can-check-again' : ''}`}
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

function props(sourceMode: string, over = {}) {
  return {
    addAmount: '',
    colors: Colors.dark,
    goal: {
      id: 'g1',
      source_mode: sourceMode,
    } as unknown as WalletActiveSavingsGoal,
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
  it('passes the wallet refresh time to the readiness gate', () => {
    render(
      <WalletSavingsFundingSection
        {...props('manual', { walletUpdatedAt: 1234 })}
      />
    );
    expect(mockGate).toHaveBeenCalledWith(1234);
  });

  it('shows wallet contribution and plan funding for manual plans', () => {
    render(<WalletSavingsFundingSection {...props('manual')} />);
    expect(screen.getByText('wallet-contribution')).toBeOnTheScreen();
    expect(screen.getByText('plan-funding')).toBeOnTheScreen();
  });

  it('shows only plan funding for non-manual plans', () => {
    render(<WalletSavingsFundingSection {...props('piggyvest')} />);
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
      useAuthStore.setState({
        user: { id: 'user-a' } as never,
        merchantId: 'merchant-1',
      });
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
    'idle',
    'loading',
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

  it('gives the note a Check again only once the poll is exhausted', () => {
    mockGate.mockReturnValue('ready');
    const checkAgain = jest.fn();
    mockPlanFunding.mockReturnValue({
      planFundingPhase: 'pending',
      fetchExistingPlanFunding: jest.fn(),
    });
    mockPoll.mockReturnValueOnce({ exhausted: true, checkAgain });
    renderManual();
    fireEvent.press(screen.getByText('status-note:pending:can-check-again'));
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

  it('renders nothing while the readiness check is still running', () => {
    mockGate.mockReturnValue('checking');
    renderManual();
    expect(screen.queryByText('wallet-contribution')).toBeNull();
    expect(screen.queryByText(/status-note/)).toBeNull();
    expect(mockPlanFunding).not.toHaveBeenCalled();
  });

  it.each([
    ['off', 'manual'],
    ['ready', 'auto_debit'],
  ])("is today's wallet contribution alone for gate %s and a %s goal", (gate, mode) => {
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
