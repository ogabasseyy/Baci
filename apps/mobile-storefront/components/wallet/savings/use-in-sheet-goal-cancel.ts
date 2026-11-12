import { useState } from 'react';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { GoalActionKind } from '@/schemas/goal-lifecycle';
import { useAuthStore } from '@/stores/auth-store';
import { useGoalLifecycle } from './use-goal-lifecycle';

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
  return {
    goal: active,
    kind,
    flow,
    start: (next: GoalActionKind = 'cancel') => {
      if (goal) setHeld({ goal, kind: next, userId });
    },
    /** Back to the savings view; nothing was sent unless the flow says so. */
    keep: () => setHeld(null),
    /** The sheet closed: drop the step and refresh the wallet if it moved money. */
    closed: () => {
      const finished = flow.step !== 'review';
      setHeld(null);
      if (finished) void refreshWallet?.();
    },
  };
}
