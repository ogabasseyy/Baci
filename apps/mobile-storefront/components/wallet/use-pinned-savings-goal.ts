import { useEffect, useRef, useState } from 'react';

/**
 * Which savings goal the wallet shows. A goal named by the route wins.
 * Otherwise, while the savings sheet is open, it stays on the goal it opened
 * on: a contribution that completes that goal must not swap the sheet to
 * another active goal (the completed goal still needs its Complete action).
 * Closing the sheet releases the pin.
 */
export function usePinnedSavingsGoal(
  sheetOpen: boolean,
  routeSavingsGoalId: string | string[] | undefined
) {
  const routeGoalId = Array.isArray(routeSavingsGoalId)
    ? routeSavingsGoalId[0]
    : routeSavingsGoalId;
  const [pinned, setPinned] = useState<string | null>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!sheetOpen) {
      if (pinned !== null) setPinned(null);
      return;
    }
    if (pinned === null && shown.current) setPinned(shown.current);
  });
  return {
    routeGoalId,
    goalId: routeGoalId ?? (sheetOpen ? pinned : null) ?? undefined,
    /** Records the goal on screen after this render (no state change). */
    noteShown: (goalId: string | null | undefined) => {
      shown.current = goalId ?? null;
    },
  };
}
