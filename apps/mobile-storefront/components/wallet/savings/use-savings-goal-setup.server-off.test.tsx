import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import { StrictMode } from 'react';
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
  planInterestAnswer,
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

describe('bugfix: a second submit while the answer was still saving sent a different answer', () => {
  it('locks on the first submit, so the server and the saved answer agree', async () => {
    // Arrange: the device write is slow.
    let finishWrite: () => void = () => undefined;
    jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        })
    );
    jest.mocked(setupExistingSavingsGoal).mockClear();
    jest
      .mocked(setupExistingSavingsGoal)
      .mockResolvedValue({ status: 'pending' });
    const { result } = renderHook(() =>
      useSavingsGoalSetup({
        goalId: SERVER_OFF_GOAL_ID,
        merchantId: SERVER_OFF_MERCHANT_ID,
        onSettled: jest.fn(),
      })
    );

    // Act: submit Yes, then No before the first write finishes.
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.submit(true);
    });
    expect(result.current.submitting).toBe(true);
    await act(async () => {
      await result.current.submit(false);
    });
    await act(async () => {
      finishWrite();
      await first;
    });

    // Assert: only Yes was sent, and Yes is what a later resume would send.
    expect(setupExistingSavingsGoal).toHaveBeenCalledTimes(1);
    expect(setupExistingSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({ interestAccepted: true })
    );
    expect(planInterestAnswer(SERVER_OFF_GOAL_ID)).toBe(true);
  });
});

describe('bugfix: a device write that never finished blocked the setup send', () => {
  it('sends the answer without waiting for the device write', async () => {
    jest
      .spyOn(AsyncStorage, 'setItem')
      .mockImplementationOnce(() => new Promise<void>(() => undefined));
    jest.mocked(setupExistingSavingsGoal).mockClear();
    jest
      .mocked(setupExistingSavingsGoal)
      .mockResolvedValue({ status: 'pending' });
    const { result } = renderHook(() =>
      useSavingsGoalSetup({
        goalId: SERVER_OFF_GOAL_ID,
        merchantId: SERVER_OFF_MERCHANT_ID,
        onSettled: jest.fn(),
      })
    );
    await act(async () => {
      await result.current.submit(false);
    });
    expect(setupExistingSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({ interestAccepted: false })
    );
    expect(planInterestAnswer(SERVER_OFF_GOAL_ID)).toBe(false);
  });
});

describe('bugfix: under StrictMode the hook thought it was unmounted', () => {
  it('re-reads status and clears submitting after a StrictMode remount', async () => {
    jest.mocked(setupExistingSavingsGoal).mockClear();
    jest
      .mocked(setupExistingSavingsGoal)
      .mockResolvedValue({ status: 'pending' });
    const onSettled = jest.fn();
    const { result } = renderHook(
      () =>
        useSavingsGoalSetup({
          goalId: SERVER_OFF_GOAL_ID,
          merchantId: SERVER_OFF_MERCHANT_ID,
          onSettled,
        }),
      { wrapper: StrictMode }
    );
    await act(async () => {
      await result.current.submit(true);
    });
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current.submitting).toBe(false);
  });
});
