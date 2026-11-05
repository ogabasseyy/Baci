import { act, renderHook } from '@testing-library/react-native';
import { useGoalLifecycle } from './use-goal-lifecycle';
import {
  cancelPrompt,
  fail,
  GOAL,
  installLifecycleHarness,
  issue,
  OP,
  PROOF,
  requestProof,
  setup,
  start,
  status,
  submit,
} from './use-goal-lifecycle.test-support';

jest.mock('@/lib/goal-lifecycle-api');
jest.mock('./use-wallet-pin-prompt');

installLifecycleHarness();

const tick = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

describe('after an indeterminate submit', () => {
  it('keeps reading through not_started instead of claiming nothing changed', async () => {
    issue.mockResolvedValue({ status: 'issued', operationId: OP });
    requestProof.mockResolvedValue(PROOF);
    submit.mockRejectedValue(fail(undefined, 'timeout'));
    status
      .mockResolvedValueOnce({ status: 'not_started', operationId: OP })
      .mockResolvedValue({ status: 'confirmed', operationId: OP });
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('polling');
    await tick(5000);
    expect(result.current.step).toBe('done');
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe('an unauthorised status read', () => {
  it('offers sign-in without saying nothing changed', async () => {
    issue.mockResolvedValue({ status: 'pending', operationId: OP });
    status.mockRejectedValue(fail('UNAUTHORIZED', 'Please sign in again.'));
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('timed_out');
    expect(result.current.needsSignIn).toBe(true);
    expect(result.current.message).toBeNull();
    expect(result.current.canStartAgain).toBe(false);
  });
});

describe('a goal or action change while a PIN sheet is open', () => {
  it('cancels the prompt for the previous goal', () => {
    const { rerender } = renderHook(
      ({ goalId }: { goalId: string }) =>
        useGoalLifecycle({ kind: 'cancel', goalId }),
      { initialProps: { goalId: GOAL } }
    );
    cancelPrompt.mockClear();
    rerender({ goalId: '44444444-4444-4444-8444-444444444444' });
    expect(cancelPrompt).toHaveBeenCalledTimes(1);
  });
});
