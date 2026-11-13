import { act, renderHook } from '@testing-library/react-native';
import {
  retrySavingsGoalSetup,
  setupExistingSavingsGoal,
} from '@/lib/customer-savings';
import {
  SERVER_OFF_GOAL_ID,
  SERVER_OFF_MERCHANT_ID,
} from '@/test-support/piggyvest-server-off.test-support';
import {
  loadPlanInterestAnswer,
  rememberPlanInterestAnswer,
  resetPlanInterestAnswers,
} from './plan-interest-answers';
import { useSavingsGoalSetup } from './use-savings-goal-setup';

jest.mock('@/lib/customer-savings', () => ({
  setupExistingSavingsGoal: jest.fn(),
  retrySavingsGoalSetup: jest.fn(),
}));

// The hook is only mounted behind a primary verdict, but even mounted on its
// own it must send nothing and re-read nothing until a customer chooses.
describe('server keeps PiggyVest off', () => {
  it('does nothing on mount and refuses to submit without a choice', async () => {
    const onSettled = jest.fn();
    const { result } = renderHook(() =>
      useSavingsGoalSetup({
        goalId: SERVER_OFF_GOAL_ID,
        merchantId: SERVER_OFF_MERCHANT_ID,
        onSettled,
      })
    );
    await act(async () => {
      await result.current.submit();
    });
    expect(setupExistingSavingsGoal).not.toHaveBeenCalled();
    expect(retrySavingsGoalSetup).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });
});

describe('bugfix: a changed answer after a failed resume was lost on restart', () => {
  it('saves the answer the customer submits, replacing the older saved one', async () => {
    jest
      .mocked(setupExistingSavingsGoal)
      .mockRejectedValueOnce(new Error('offline'));
    await rememberPlanInterestAnswer(SERVER_OFF_GOAL_ID, true);
    const { result } = renderHook(() =>
      useSavingsGoalSetup({
        goalId: SERVER_OFF_GOAL_ID,
        merchantId: SERVER_OFF_MERCHANT_ID,
        onSettled: jest.fn(),
      })
    );
    act(() => result.current.setChoice(false));
    await act(async () => {
      await result.current.submit();
    });
    resetPlanInterestAnswers(); // the app restarted
    expect(await loadPlanInterestAnswer(SERVER_OFF_GOAL_ID)).toBe(false);
  });
});
