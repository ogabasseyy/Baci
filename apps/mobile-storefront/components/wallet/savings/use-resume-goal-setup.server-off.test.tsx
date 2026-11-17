import { act, renderHook } from '@testing-library/react-native';
import {
  loadPlanInterestAnswer,
  rememberPlanInterestAnswer,
  resetPlanInterestAnswers,
} from './plan-interest-answers';
import { useResumeGoalSetup } from './use-resume-goal-setup';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';

type Props = {
  phase: SavingsPlanFundingPhase;
  failed?: boolean;
  attempted?: boolean;
};

function setup(initial: Props, active = true) {
  const submit = jest.fn(async () => undefined);
  const setChoice = jest.fn();
  const view = renderHook(
    (props: Props) =>
      useResumeGoalSetup({
        active,
        goalId: 'goal-1',
        phase: props.phase,
        failed: props.failed ?? false,
        attempted: props.attempted ?? false,
        setChoice,
        submit,
      }),
    { initialProps: initial }
  );
  return { ...view, submit, setChoice };
}

beforeEach(() => resetPlanInterestAnswers());

describe('useResumeGoalSetup with PiggyVest off', () => {
  it('does nothing without a remembered answer, or for a legacy merchant', async () => {
    const plain = setup({ phase: 'not_started' });
    await act(async () => {});
    expect(plain.submit).not.toHaveBeenCalled();
    expect(plain.result.current.resuming).toBe(false);
    rememberPlanInterestAnswer('goal-1', true);
    const legacy = setup({ phase: 'not_started' }, false);
    await act(async () => {});
    expect(legacy.submit).not.toHaveBeenCalled();
  });

  describe('bugfix: a setup start that never landed asked the interest question again', () => {
    it('finishes setup once with the form answer', async () => {
      rememberPlanInterestAnswer('goal-1', false);
      const { submit, setChoice, result, rerender } = setup({
        phase: 'not_started',
      });
      await act(async () => {});
      expect(setChoice).toHaveBeenCalledWith(false);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledWith(false);
      expect(result.current.resuming).toBe(true);
      rerender({ phase: 'loading' });
      rerender({ phase: 'not_started' });
      await act(async () => {});
      expect(submit).toHaveBeenCalledTimes(1);
    });

    it('hands back to the usual question if that submit fails', async () => {
      rememberPlanInterestAnswer('goal-1', true);
      const { result, rerender } = setup({ phase: 'not_started' });
      await act(async () => {});
      rerender({ phase: 'not_started', failed: true });
      expect(result.current.resuming).toBe(false);
    });

    it('waits for a not-started reading before sending', async () => {
      rememberPlanInterestAnswer('goal-1', true);
      const { submit } = setup({ phase: 'pending' });
      await act(async () => {});
      expect(submit).not.toHaveBeenCalled();
    });
  });

  describe('bugfix: after an app restart the question was asked again', () => {
    it('finishes setup with the answer saved on the device', async () => {
      await rememberPlanInterestAnswer('goal-1', true);
      resetPlanInterestAnswers(); // the app restarted
      const { submit } = setup({ phase: 'not_started' });
      await act(async () => {});
      await act(async () => {});
      expect(submit).toHaveBeenCalledWith(true);
    });

    it('forgets the saved answer once the plan is ready', async () => {
      await rememberPlanInterestAnswer('goal-1', true);
      setup({ phase: 'ready' });
      await act(async () => {});
      resetPlanInterestAnswers();
      expect(await loadPlanInterestAnswer('goal-1')).toBeNull();
    });
  });

  describe('bugfix: a saved answer loading late raced the customer’s own answer', () => {
    it('never sends the saved answer once the customer has submitted theirs', async () => {
      await rememberPlanInterestAnswer('goal-1', true);
      resetPlanInterestAnswers(); // the app restarted: the answer is on the device
      const { submit, result } = setup({
        phase: 'not_started',
        attempted: true,
      });
      await act(async () => {});
      await act(async () => {});
      expect(submit).not.toHaveBeenCalled();
      expect(result.current.resuming).toBe(false);
    });
  });
});
