import { useEffect, useRef, useState } from 'react';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { isFundedUnsettledGoal } from './savings/goal-settlement';

/**
 * Which savings goal the wallet shows. A goal named by the route wins.
 * Otherwise, while the savings sheet is open, it stays on the goal it opened
 * on: a contribution that completes that goal must not swap the sheet to
 * another active goal (the completed goal still needs its Complete action).
 * Pass the sheet as open while a contribution is still settling too: the pin
 * holds until it settles, even if the sheet was dismissed meanwhile.
 * Closing the sheet (with nothing in flight) releases the pin.
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
    if (!sheetOpen) {
      // A goal that was just completed and still holds money stays selected
      // until it settles: its Complete action must remain reachable.
      if (pinned !== null && !isFundedUnsettledGoal(shown.current))
        setPinned(null);
      return;
    }
    if (pinned === null && shown.current) setPinned(shown.current.id);
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
