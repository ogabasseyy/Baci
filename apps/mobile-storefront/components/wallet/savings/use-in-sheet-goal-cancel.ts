import { useEffect, useRef, useState } from 'react';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { GoalActionKind } from '@/schemas/goal-lifecycle';
import { useAuthStore } from '@/stores/auth-store';
import { useGoalLifecycle } from './use-goal-lifecycle';

const IN_FLIGHT = new Set(['submitting', 'polling']);

/**
 * Cancelling or completing a goal as a step inside the Add to savings sheet.
 * The goal being acted on is held (pinned to the signed-in account) so the step keeps its
 * subject even after a wallet refresh drops the cancelled goal.
 */
export function useInSheetGoalCancel(
  goal: WalletActiveSavingsGoal | null,
  refreshWallet?: () => unknown
) {
  const userId = useAuthStore((state) => state.user?.id);
  const [held, setHeld] = useState<{
    goal: WalletActiveSavingsGoal;
    kind: GoalActionKind;
    userId: string | undefined;
  } | null>(null);
  const active = held && held.userId === userId ? held.goal : null;
  const kind: GoalActionKind = held?.kind ?? 'cancel';
  // Each time the step opens it starts fresh, never on a stale outcome.
  const [attempt, setAttempt] = useState(0);
  const flow = useGoalLifecycle({
    kind,
    goalId: active?.id ?? goal?.id ?? '',
    resetKey: attempt,
  });
  // Refresh once an action actually settles (or may have), whether or not
  // the sheet is still open.
  // Exactly once per attempt: the refresh callback is a new function on
  // every wallet render, so it must not drive the effect.
  const settled = flow.step === 'done' || flow.step === 'timed_out';
  const refreshRef = useRef(refreshWallet);
  refreshRef.current = refreshWallet;
  // Keyed by outcome too: a timed-out attempt that later confirms after
  // "Check again" refreshes again, once.
  const refreshed = useRef<string | null>(null);
  const outcomeKey = settled ? `${attempt}:${flow.step}` : null;
  useEffect(() => {
    if (!outcomeKey || refreshed.current === outcomeKey) return;
    refreshed.current = outcomeKey;
    void refreshRef.current?.();
  }, [outcomeKey]);

  return {
    goal: active,
    kind,
    flow,
    start: (next: GoalActionKind = 'cancel') => {
      if (!goal) return;
      setAttempt((value) => value + 1);
      setHeld({ goal, kind: next, userId });
    },
    /** Back to the savings view; nothing was sent unless the flow says so. */
    keep: () => setHeld(null),
    /**
     * The sheet closed. An action still being saved stays tracked, so its
     * result refreshes the wallet when it settles; anything else is dropped.
     */
    closed: () => {
      if (!IN_FLIGHT.has(flow.step)) setHeld(null);
    },
  };
}
