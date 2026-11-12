import { act, renderHook } from '@testing-library/react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { useAuthStore } from '@/stores/auth-store';
import { useInSheetGoalCancel } from './use-in-sheet-goal-cancel';

const mockStep = { current: 'review' };
const mockLifecycle = jest.fn();
jest.mock('./use-goal-lifecycle', () => ({
  useGoalLifecycle: (args: unknown) => {
    mockLifecycle(args);
    return { step: mockStep.current, sheetProps: {} };
  },
}));

const goal = {
  id: 'goal-1',
  title: 'Phone',
  status: 'active',
  current_amount: 0,
  target_amount: 250000,
  maturity_date: '2027-03-16',
  source_mode: 'manual',
  contribution_amount: 5000,
  contribution_frequency: 'weekly',
} as WalletActiveSavingsGoal;

function signIn(id: string) {
  act(() => {
    useAuthStore.setState({ user: { id } as never, merchantId: 'm-1' });
  });
}

beforeEach(() => {
  mockStep.current = 'review';
  mockLifecycle.mockClear();
  signIn('user-a');
});

// With PiggyVest off on the server the cancel step can still open and close:
// it never refreshes the wallet unless an attempt actually went out.
describe('in-sheet goal cancel with the server off', () => {
  it('holds the goal while cancelling and lets the customer go back', () => {
    const refresh = jest.fn();
    const { result } = renderHook(() => useInSheetGoalCancel(goal, refresh));
    expect(result.current.goal).toBeNull();
    act(() => result.current.start());
    expect(result.current.goal?.id).toBe('goal-1');
    expect(mockLifecycle).toHaveBeenLastCalledWith({
      kind: 'cancel',
      goalId: 'goal-1',
    });
    act(() => result.current.keep());
    expect(result.current.goal).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps the goal on screen after the wallet stops listing it', () => {
    const { result, rerender } = renderHook(
      ({ g }: { g: WalletActiveSavingsGoal | null }) => useInSheetGoalCancel(g),
      { initialProps: { g: goal as WalletActiveSavingsGoal | null } }
    );
    act(() => result.current.start());
    rerender({ g: null });
    expect(result.current.goal?.id).toBe('goal-1');
  });

  it('refreshes the wallet on close only after an attempt went out', () => {
    const refresh = jest.fn();
    const { result, rerender } = renderHook(() =>
      useInSheetGoalCancel(goal, refresh)
    );
    act(() => result.current.start());
    act(() => result.current.closed());
    expect(refresh).not.toHaveBeenCalled();
    act(() => result.current.start());
    mockStep.current = 'failed';
    rerender({});
    act(() => result.current.closed());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.current.goal).toBeNull();
  });

  it('never shows one account the goal another account was cancelling', () => {
    const { result } = renderHook(() => useInSheetGoalCancel(goal));
    act(() => result.current.start());
    signIn('user-b');
    expect(result.current.goal).toBeNull();
  });
});
