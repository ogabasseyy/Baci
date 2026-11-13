import { renderHook } from '@testing-library/react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import {
  rememberGoalSetupPhase,
  resetGoalSetupMemory,
} from './goal-setup-memory';
import { useGoalCardSetupState } from './use-goal-card-setup-state';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';

let mockPhase: SavingsPlanFundingPhase = 'loading';
let mockPrimary = true;
let mockUserId: string | undefined = 'user-1';
const mockFundingInput = jest.fn();
const mockPollInput = jest.fn();
const mockPollSince = jest.fn();
const mockPollPaused = jest.fn();

jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: 'merchant-1' } }));
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: () => mockPrimary,
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: mockUserId ? { id: mockUserId } : null,
      merchantId: 'merchant-1',
    }),
}));
jest.mock('./use-savings-plan-funding', () => ({
  useSavingsPlanFunding: (input: unknown) => {
    mockFundingInput(input);
    return { planFundingPhase: mockPhase, fetchExistingPlanFunding: jest.fn() };
  },
}));
jest.mock('./use-goal-wallet-setup-poll', () => ({
  useGoalWalletSetupPoll: (input: {
    phase: string;
    pendingSince?: number | null;
    readsPaused?: boolean;
  }) => {
    mockPollInput(input.phase);
    mockPollPaused(input.readsPaused ?? false);
    mockPollSince(input.pendingSince);
    return { slow: false, paused: false, checkAgain: jest.fn() };
  },
}));

const goal = (change: Partial<WalletActiveSavingsGoal> = {}) =>
  ({
    id: 'goal-1',
    source_mode: 'manual',
    status: 'active',
    ...change,
  }) as WalletActiveSavingsGoal;
const run = (g = goal(), pausePolling = false) =>
  renderHook(() => useGoalCardSetupState(g, pausePolling)).result.current;

beforeEach(() => {
  jest.clearAllMocks();
  resetGoalSetupMemory();
  mockPhase = 'loading';
  mockPrimary = true;
  mockUserId = 'user-1';
});

describe('useGoalCardSetupState', () => {
  it('says getting ready for a plan still being set up, and keeps checking', () => {
    mockPhase = 'pending';
    expect(run()).toBe('getting_ready');
    expect(mockPollInput).toHaveBeenLastCalledWith('pending');
  });

  it('bugfix: sends no reads while the savings sheet checks the same plan, but keeps its status', () => {
    mockPhase = 'pending';
    expect(run(goal(), true)).toBe('getting_ready');
    expect(mockPollPaused).toHaveBeenLastCalledWith(true);
    // Still told the plan is pending, so it can keep a slow notice up.
    expect(mockPollInput).toHaveBeenLastCalledWith('pending');
  });

  it('times a slow setup from the plan creation time', () => {
    mockPhase = 'pending';
    run(goal({ created_at: '2026-11-12T08:00:00Z' }));
    expect(mockPollSince).toHaveBeenLastCalledWith(
      Date.parse('2026-11-12T08:00:00Z')
    );
  });

  it('says getting ready for a stalled setup', () => {
    mockPhase = 'setup_retryable';
    expect(run()).toBe('getting_ready');
  });

  it('bugfix: keeps reading a stalled setup so the card recovers once the plan is ready', () => {
    mockPhase = 'setup_retryable';
    run();
    // Read like a pending setup (status reads only, never a setup re-run).
    expect(mockPollInput).toHaveBeenLastCalledWith('pending');
  });

  it('asks to finish setup when it never started', () => {
    mockPhase = 'not_started';
    expect(run()).toBe('needs_setup');
  });

  it('invites a first contribution only once the plan is ready', () => {
    mockPhase = 'ready';
    expect(run()).toBeNull();
  });

  describe('bugfix: a cold open flashed the ready card before the status was known', () => {
    it.each([
      'idle',
      'loading',
      'error',
    ] as const)('stays neutral while the status is unknown (%s)', (phase) => {
      mockPhase = phase;
      expect(run()).toBe('checking');
    });
  });

  it('says setup needs a hand when the server cannot finish it', () => {
    mockPhase = 'unavailable';
    expect(run()).toBe('needs_help');
  });

  it('uses what the savings sheet last learned while re-reading', () => {
    rememberGoalSetupPhase(
      JSON.stringify(['user-1', 'merchant-1', 'goal-1']),
      'pending'
    );
    expect(run()).toBe('getting_ready');
  });

  it('reads nothing for legacy merchants, auto-debit or finished plans, or signed-out customers', () => {
    mockPhase = 'pending';
    mockPrimary = false;
    expect(run()).toBeNull();
    mockPrimary = true;
    expect(run(goal({ source_mode: 'auto_debit' }))).toBeNull();
    expect(run(goal({ status: 'completed' }))).toBeNull();
    mockUserId = undefined;
    expect(run()).toBeNull();
    expect(mockFundingInput).toHaveBeenLastCalledWith(
      expect.objectContaining({ goalId: null, loadExisting: false })
    );
    expect(mockPollInput).toHaveBeenLastCalledWith('idle');
  });
});
