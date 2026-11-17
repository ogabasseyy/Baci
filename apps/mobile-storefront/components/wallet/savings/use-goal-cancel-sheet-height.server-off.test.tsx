import { act, renderHook } from '@testing-library/react-native';
import type { GoalActionKind } from '@/schemas/goal-lifecycle';
import type { GoalLifecycleStep } from './goal-lifecycle-outcomes';
import {
  useGoalCancelSheetHeight,
  useStepSheetHeight,
} from './use-goal-cancel-sheet-height';

type Props = {
  goalId: string | null;
  kind?: GoalActionKind;
  step?: GoalLifecycleStep;
};

function setup(initialProps: Props) {
  return renderHook(
    ({ goalId, kind = 'cancel', step = 'review' }: Props) =>
      useGoalCancelSheetHeight({
        goal: goalId ? { id: goalId } : null,
        kind,
        flow: { step },
      }),
    { initialProps }
  );
}

// Pure sizing: no server call, so it is the same with PiggyVest on or off.
describe('useGoalCancelSheetHeight', () => {
  it('is unmeasured until the step reports its content height', () => {
    const { result } = setup({ goalId: 'goal-1' });
    expect(result.current.height).toBe(0);
    act(() => result.current.measure(390, 311.2));
    expect(result.current.height).toBe(312);
  });

  it('never opens on the height of an earlier review', () => {
    const { result, rerender } = setup({ goalId: 'goal-1' });
    act(() => result.current.measure(390, 300));
    // Keep saving, then Cancel goal again: the old height is dropped.
    rerender({ goalId: null });
    rerender({ goalId: 'goal-1' });
    expect(result.current.height).toBe(0);
    act(() => result.current.measure(390, 300));
    // Switching to Complete is different content: measured afresh too.
    rerender({ goalId: 'goal-1', kind: 'complete' });
    expect(result.current.height).toBe(0);
  });

  // Simulator 2026-11-17: the spinner row that replaces the Cancel goal /
  // Keep saving buttons is shorter, so the sheet moved again before the PIN.
  it('holds the height while a request is out, then follows the content', () => {
    const { result, rerender } = setup({ goalId: 'goal-1' });
    act(() => result.current.measure(390, 420));
    rerender({ goalId: 'goal-1', step: 'issuing' });
    act(() => result.current.measure(390, 330));
    expect(result.current.height).toBe(420);
    rerender({ goalId: 'goal-1', step: 'pin' });
    rerender({ goalId: 'goal-1', step: 'submitting' });
    expect(result.current.height).toBe(420);
    rerender({ goalId: 'goal-1', step: 'done' });
    act(() => result.current.measure(390, 280));
    expect(result.current.height).toBe(280);
  });

  it('bugfix (Codex): after the request settles it waits for the outcome, never the spinner height', () => {
    const view = setup({ goalId: 'goal-1' });
    act(() => view.result.current.measure(390, 400));
    view.rerender({ goalId: 'goal-1', step: 'submitting' });
    // The shorter spinner row is ignored while busy.
    act(() => view.result.current.measure(390, 250));
    expect(view.result.current.height).toBe(400);
    view.rerender({ goalId: 'goal-1', step: 'done' });
    // Settled: unmeasured (the sheet keeps its height) until the outcome is.
    expect(view.result.current.height).toBe(0);
    act(() => view.result.current.measure(390, 330));
    expect(view.result.current.height).toBe(330);
  });
});

describe('useStepSheetHeight (phone swap)', () => {
  it('bugfix (Muse): a second opening starts unmeasured, not on the old height', () => {
    const view = renderHook(
      ({ open }: { open: boolean }) =>
        useStepSheetHeight(open ? 'swap' : null, false),
      { initialProps: { open: true } }
    );
    act(() => view.result.current.measure(390, 500));
    expect(view.result.current.height).toBe(500);
    view.rerender({ open: false });
    view.rerender({ open: true });
    expect(view.result.current.height).toBe(0);
  });
});
