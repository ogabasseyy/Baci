import { act, renderHook } from '@testing-library/react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { useAuthStore } from '@/stores/auth-store';
import { notifySavings, useSavingsNotice } from './savings-notice';
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
    expect(mockLifecycle).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'cancel', goalId: 'goal-1' })
    );
    act(() => result.current.keep());
    expect(result.current.goal).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('starts a fresh attempt each time the step opens', () => {
    const { result } = renderHook(() => useInSheetGoalCancel(goal));
    act(() => result.current.start());
    const first = mockLifecycle.mock.calls.at(-1)?.[0] as { resetKey: number };
    act(() => result.current.keep());
    act(() => result.current.start());
    const second = mockLifecycle.mock.calls.at(-1)?.[0] as { resetKey: number };
    expect(second.resetKey).toBeGreaterThan(first.resetKey);
  });

  it('runs the complete action when started for it', () => {
    const { result } = renderHook(() => useInSheetGoalCancel(goal));
    act(() => result.current.start('complete'));
    expect(result.current.kind).toBe('complete');
    expect(mockLifecycle).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'complete', goalId: 'goal-1' })
    );
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

  it('keeps tracking an action still being saved when the sheet closes, and refreshes when it settles', () => {
    const refresh = jest.fn();
    const { result, rerender } = renderHook(() =>
      useInSheetGoalCancel(goal, refresh)
    );
    act(() => result.current.start());
    mockStep.current = 'submitting';
    rerender({});
    act(() => result.current.closed());
    expect(result.current.goal?.id).toBe('goal-1');
    expect(refresh).not.toHaveBeenCalled();
    mockStep.current = 'done';
    rerender({});
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('retries a refresh that resolves with an error, then asks to pull down', async () => {
    const refresh = jest.fn(async () => ({ isError: true }));
    const notice = renderHook(() => useSavingsNotice());
    const { result, rerender } = renderHook(() =>
      useInSheetGoalCancel(goal, refresh)
    );
    act(() => result.current.start());
    mockStep.current = 'done';
    await act(async () => {
      rerender({});
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(notice.result.current.notice?.title).toBe('Pull to refresh');
  });

  it('refreshes once per settled action, even when the refresh callback changes every render', () => {
    const { result, rerender } = renderHook(
      ({ cb }: { cb: () => unknown }) => useInSheetGoalCancel(goal, cb),
      { initialProps: { cb: jest.fn() as () => unknown } }
    );
    act(() => result.current.start());
    mockStep.current = 'done';
    const calls: jest.Mock[] = [];
    for (let i = 0; i < 4; i += 1) {
      const cb = jest.fn();
      calls.push(cb);
      rerender({ cb });
    }
    const total = calls.reduce((sum, cb) => sum + cb.mock.calls.length, 0);
    expect(total).toBe(1);
  });

  it('refreshes again when a timed-out action confirms after Check again', () => {
    const refresh = jest.fn();
    const { result, rerender } = renderHook(() =>
      useInSheetGoalCancel(goal, refresh)
    );
    act(() => result.current.start());
    mockStep.current = 'timed_out';
    rerender({});
    mockStep.current = 'polling';
    rerender({});
    mockStep.current = 'done';
    rerender({});
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('refreshes the wallet when an action needs review', () => {
    const refresh = jest.fn();
    const { result, rerender } = renderHook(() =>
      useInSheetGoalCancel(goal, refresh)
    );
    act(() => result.current.start());
    mockStep.current = 'submitting';
    rerender({});
    mockStep.current = 'needs_review';
    rerender({});
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('releases a goal closed mid-save once its action settles', () => {
    const { result, rerender } = renderHook(() => useInSheetGoalCancel(goal));
    act(() => result.current.start());
    mockStep.current = 'submitting';
    rerender({});
    act(() => result.current.closed());
    expect(result.current.goal?.id).toBe('goal-1');
    mockStep.current = 'done';
    rerender({});
    expect(result.current.goal).toBeNull();
  });

  it('keeps a held step when the sheet is reopened before the action settles', () => {
    const { result, rerender } = renderHook(
      ({ visible }: { visible: boolean }) =>
        useInSheetGoalCancel(goal, undefined, visible),
      { initialProps: { visible: true } }
    );
    act(() => result.current.start());
    mockStep.current = 'submitting';
    rerender({ visible: true });
    act(() => result.current.closed());
    rerender({ visible: false });
    rerender({ visible: true });
    mockStep.current = 'timed_out';
    rerender({ visible: true });
    expect(result.current.goal?.id).toBe('goal-1');
  });

  it('drops a finished or untouched step on close without refreshing', () => {
    const refresh = jest.fn();
    const { result, rerender } = renderHook(() =>
      useInSheetGoalCancel(goal, refresh)
    );
    act(() => result.current.start());
    mockStep.current = 'pin_cancelled';
    rerender({});
    act(() => result.current.closed());
    expect(result.current.goal).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('abandons an action still being issued when the sheet closes', () => {
    const { result, rerender } = renderHook(() => useInSheetGoalCancel(goal));
    act(() => result.current.start());
    const opened = mockLifecycle.mock.calls.at(-1)?.[0] as { resetKey: number };
    mockStep.current = 'issuing';
    rerender({});
    act(() => result.current.closed());
    const after = mockLifecycle.mock.calls.at(-1)?.[0] as { resetKey: number };
    expect(result.current.goal).toBeNull();
    // A new attempt invalidates the pending request, so no hidden PIN step.
    expect(after.resetKey).toBeGreaterThan(opened.resetKey);
  });

  it('clears an earlier savings notice when a cancel or complete starts', () => {
    const notice = renderHook(() => useSavingsNotice());
    act(() => notifySavings('Savings updated', 'Keep it going!', 'success'));
    expect(notice.result.current.notice?.title).toBe('Savings updated');
    const { result } = renderHook(() => useInSheetGoalCancel(goal));
    act(() => result.current.start('cancel'));
    expect(notice.result.current.notice).toBeNull();
  });

  it('never shows one account the goal another account was cancelling', () => {
    const { result } = renderHook(() => useInSheetGoalCancel(goal));
    act(() => result.current.start());
    signIn('user-b');
    expect(result.current.goal).toBeNull();
  });

  it('never shows one store the goal held in another store', () => {
    const { result } = renderHook(() => useInSheetGoalCancel(goal));
    act(() => result.current.start());
    expect(result.current.goal?.id).toBe('goal-1');
    act(() => {
      useAuthStore.setState({ merchantId: 'm-2' });
    });
    expect(result.current.goal).toBeNull();
  });

  it('drops a held goal when the store changes, so switching back never revives it', () => {
    const { result } = renderHook(() => useInSheetGoalCancel(goal));
    act(() => result.current.start());
    act(() => {
      useAuthStore.setState({ merchantId: 'm-2' });
    });
    act(() => {
      useAuthStore.setState({ merchantId: 'm-1' });
    });
    expect(result.current.goal).toBeNull();
  });
});
