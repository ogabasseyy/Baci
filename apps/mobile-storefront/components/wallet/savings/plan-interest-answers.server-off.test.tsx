import {
  planInterestAnswer,
  rememberPlanInterestAnswer,
  resetPlanInterestAnswers,
} from './plan-interest-answers';

beforeEach(() => resetPlanInterestAnswers());

describe('plan interest answers with PiggyVest off', () => {
  it('knows nothing until a plan is created with an answer', () => {
    expect(planInterestAnswer('goal-1')).toBeNull();
  });

  it('keeps the form answer for the plan, yes or no', () => {
    rememberPlanInterestAnswer('goal-1', false);
    rememberPlanInterestAnswer('goal-2', true);
    expect(planInterestAnswer('goal-1')).toBe(false);
    expect(planInterestAnswer('goal-2')).toBe(true);
  });
});
