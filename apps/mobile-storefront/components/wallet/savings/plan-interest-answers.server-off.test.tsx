import {
  forgetPlanInterestAnswer,
  loadPlanInterestAnswer,
  planInterestAnswer,
  rememberPlanInterestAnswer,
  resetPlanInterestAnswers,
} from './plan-interest-answers';

beforeEach(() => resetPlanInterestAnswers());

describe('plan interest answers with PiggyVest off', () => {
  it('knows nothing until a plan is created with an answer', () => {
    expect(planInterestAnswer('goal-1')).toBeNull();
  });

  it('keeps the form answer for the plan, yes or no', async () => {
    await rememberPlanInterestAnswer('goal-1', false);
    await rememberPlanInterestAnswer('goal-2', true);
    expect(planInterestAnswer('goal-1')).toBe(false);
    expect(planInterestAnswer('goal-2')).toBe(true);
  });

  describe('bugfix: an app restart lost the answer and asked again', () => {
    it('reads the answer back from the device after a restart', async () => {
      await rememberPlanInterestAnswer('goal-3', true);
      resetPlanInterestAnswers(); // the app restarted
      expect(planInterestAnswer('goal-3')).toBeNull();
      expect(await loadPlanInterestAnswer('goal-3')).toBe(true);
    });

    it('forgets it once the plan is set up', async () => {
      await rememberPlanInterestAnswer('goal-4', false);
      await forgetPlanInterestAnswer('goal-4');
      resetPlanInterestAnswers();
      expect(await loadPlanInterestAnswer('goal-4')).toBeNull();
    });
  });
});
