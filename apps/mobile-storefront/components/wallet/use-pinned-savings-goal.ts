import { useEffect, useRef, useState } from 'react';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { isFundedUnsettledGoal } from './savings/goal-settlement';

/**
 * Which savings goal the wallet shows. A goal named by the route wins.
 * Otherwise the goal the savings sheet opened on (or a contribution started
 * on) stays selected: a contribution that completes it must not swap the
 * wallet to another active goal, even if the sheet is closed and reopened
 * meanwhile, because the completed goal still needs its Complete action.
 * The pin is released only when that goal leaves the list (cancelled, or
 * another account) or is completed and settled, so the wallet falls back
 * to its default goal.
 */
export function usePinnedSavingsGoal(
  sheetOpen: boolean,
  routeSavingsGoalId: string | string[] | undefined
) {
  const routeGoalId = Array.isArray(routeSavingsGoalId)
    ? routeSavingsGoalId[0]
    : routeSavingsGoalId;
  const [pinned, setPinned] = useState<string | null>(null);
  const shown = useRef<WalletActiveSavingsGoal | null>(null);
  useEffect(() => {
    const goal = shown.current;
    if (pinned !== null) {
      const gone = goal === null || goal.id !== pinned;
      const settled =
        goal?.status === 'completed' && !isFundedUnsettledGoal(goal);
      if (gone || settled) setPinned(null);
      return;
    }
    if (sheetOpen && goal) setPinned(goal.id);
  });
  return {
    routeGoalId,
    goalId: routeGoalId ?? pinned ?? undefined,
    /** Records the goal on screen after this render (no state change). */
    noteShown: (goal: WalletActiveSavingsGoal | null | undefined) => {
      shown.current = goal ?? null;
    },
  };
}
