import { useEffect, useState } from 'react';
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
  const flow = useGoalLifecycle({
    kind,
    goalId: active?.id ?? goal?.id ?? '',
  });
  // Refresh once an action actually settles (or may have), whether or not
  // the sheet is still open.
  const settled = flow.step === 'done' || flow.step === 'timed_out';
  useEffect(() => {
    if (settled) void refreshWallet?.();
  }, [settled, refreshWallet]);

  return {
    goal: active,
    kind,
    flow,
    start: (next: GoalActionKind = 'cancel') => {
      if (goal) setHeld({ goal, kind: next, userId });
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
