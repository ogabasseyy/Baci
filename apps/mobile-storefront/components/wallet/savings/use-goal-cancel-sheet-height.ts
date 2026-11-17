import { useState } from 'react';
import type { GoalActionKind } from '@/schemas/goal-lifecycle';
import {
  GOAL_ACTION_BUSY_STEPS,
  type GoalLifecycleStep,
} from './goal-lifecycle-outcomes';

/**
 * The measured height of a step that replaces the savings sheet's content.
 *
 * Each opening (a new key) starts unmeasured (0): the sheet keeps the height
 * already on screen until this step is measured, then moves once. While busy,
 * new measurements are ignored, so the spinner never shrinks the sheet; when
 * the step settles the measurement is dropped again, so the sheet holds until
 * the outcome is measured instead of snapping to the spinner's height first.
 */
export function useStepSheetHeight(key: string | null, busy: boolean) {
  const [shown, setShown] = useState({ key, busy });
  const [measured, setMeasured] = useState(0);
  // Adjusted during render (React's previous-render pattern).
  if (shown.key !== key || shown.busy !== busy) {
    setShown({ key, busy });
    // A new opening, or a request that just settled: measure afresh.
    if (shown.key !== key || (shown.busy && !busy)) setMeasured(0);
  }
  return {
    height: shown.key === key ? measured : 0,
    /** BottomSheetScrollView's onContentSizeChange. */
    measure: (_width: number, contentHeight: number) => {
      if (!busy) setMeasured(Math.ceil(contentHeight));
    },
  };
}

type InSheetGoalAction = {
  goal: { id: string } | null;
  kind: GoalActionKind;
  flow: { step: GoalLifecycleStep };
};

/** The in-sheet Cancel / Complete step's height (see useStepSheetHeight). */
export function useGoalCancelSheetHeight(action: InSheetGoalAction) {
  return useStepSheetHeight(
    action.goal ? `${action.goal.id}:${action.kind}` : null,
    GOAL_ACTION_BUSY_STEPS.has(action.flow.step)
  );
}
