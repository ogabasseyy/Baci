import { useState } from 'react';
import type { GoalActionKind } from '@/schemas/goal-lifecycle';
import { useHeldWhileAdding } from '../use-held-while-adding';
import type { GoalLifecycleStep } from './goal-lifecycle-outcomes';

/** Steps that swap the buttons for a spinner while a request is out. */
const BUSY_STEPS: ReadonlySet<GoalLifecycleStep> = new Set([
  'issuing',
  'pin',
  'submitting',
  'polling',
]);

type InSheetGoalAction = {
  goal: { id: string } | null;
  kind: GoalActionKind;
  flow: { step: GoalLifecycleStep };
};

/**
 * The measured height of the in-sheet Cancel / Complete step.
 *
 * Each opening starts unmeasured (0), never on the height of an earlier
 * review, so the sheet keeps the height already on screen until this step is
 * measured and then moves once, straight to its fitted height. While a
 * request is out a spinner replaces the buttons: the height is held so the
 * sheet does not move before the PIN step takes it over.
 */
export function useGoalCancelSheetHeight(action: InSheetGoalAction) {
  const key = action.goal ? `${action.goal.id}:${action.kind}` : null;
  const [shownKey, setShownKey] = useState(key);
  const [measured, setMeasured] = useState(0);
  // Adjusted during render: a new opening (or a closed step) drops the old
  // measurement before it can size the sheet.
  if (shownKey !== key) {
    setShownKey(key);
    setMeasured(0);
  }
  const height = useHeldWhileAdding(
    BUSY_STEPS.has(action.flow.step),
    shownKey === key && measured > 0 ? measured : undefined
  );
  return {
    height: height ?? 0,
    /** BottomSheetScrollView's onContentSizeChange. */
    measure: (_width: number, contentHeight: number) =>
      setMeasured(Math.ceil(contentHeight)),
  };
}
