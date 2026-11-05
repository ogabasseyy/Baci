import { act } from '@testing-library/react-native';
import { useAuthStore } from '@/stores/auth-store';
import {
  fail,
  installLifecycleHarness,
  issue,
  OP,
  PROOF,
  requestProof,
  run,
  setup,
  start,
  status,
  submit,
} from './use-goal-lifecycle.test-support';

jest.mock('@/lib/goal-lifecycle-api');
jest.mock('./use-wallet-pin-prompt');

installLifecycleHarness();

describe('submit outcomes', () => {
  beforeEach(() => {
    issue.mockResolvedValue({ status: 'issued', operationId: OP });
    requestProof.mockResolvedValue(PROOF);
  });

  it.each([
    ['CANCEL_UNAVAILABLE', fail('CANCEL_UNAVAILABLE')],
    ['a network error', fail(undefined, 'Network request failed')],
    [
      'an unreadable reply',
      fail(
        undefined,
        'We could not confirm this. Check its status before trying again.'
      ),
    ],
  ])('%s is indeterminate: it polls status and never submits again', async (_name, error) => {
    submit.mockRejectedValue(error);
    status
      .mockResolvedValueOnce({ status: 'pending', operationId: OP })
      .mockResolvedValueOnce({ status: 'confirmed', operationId: OP });
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('polling');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.step).toBe('done');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('GOAL_NEEDS_REVIEW stops with the server message and no retry', async () => {
    submit.mockRejectedValue(
      fail(
        'GOAL_NEEDS_REVIEW',
        "Your savings are safe. Please don't try again while we check."
      )
    );
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('needs_review');
    expect(result.current.message).toBe(
      "Your savings are safe. Please don't try again while we check."
    );
    expect(result.current.canStartAgain).toBe(false);
    expect(status).not.toHaveBeenCalled();
  });

  it.each([
    ['CANCEL_REJECTED', false],
    ['NOTHING_TO_REFUND', false],
    ['AMOUNT_TOO_LARGE', false],
    ['CANCEL_EXPIRED', true],
    ['CANCEL_BUSY', true],
  ])('%s shows the server text (start again: %s)', async (code, again) => {
    submit.mockRejectedValue(fail(code, `text for ${code}`));
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('failed');
    expect(result.current.message).toBe(`text for ${code}`);
    expect(result.current.canStartAgain).toBe(again);
    expect(status).not.toHaveBeenCalled();
  });

  it('Start again after an expiry re-issues', async () => {
    submit.mockRejectedValueOnce(fail('CANCEL_EXPIRED', 'Expired.'));
    const { result } = setup();
    await start(result);
    submit.mockResolvedValue({ status: 'confirmed', operationId: OP });
    await start(result);
    expect(issue).toHaveBeenCalledTimes(2);
    expect(result.current.step).toBe('done');
  });

  it('a pending submit answer polls', async () => {
    submit.mockResolvedValue({ status: 'pending', operationId: OP });
    status.mockResolvedValue({ status: 'needs_review', operationId: OP });
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('needs_review');
  });
});

describe('polling', () => {
  beforeEach(() => {
    issue.mockResolvedValue({ status: 'pending', operationId: OP });
    status.mockResolvedValue({ status: 'pending', operationId: OP });
  });

  it('stops after two minutes, then Check again polls on the same operation', async () => {
    const { result } = setup();
    await start(result);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(120_000);
    });
    expect(result.current.step).toBe('timed_out');
    const calls = status.mock.calls.length;
    expect(calls).toBe(25);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(status).toHaveBeenCalledTimes(calls);
    status.mockResolvedValue({ status: 'confirmed', operationId: OP });
    await run(() => result.current.checkAgain());
    expect(result.current.step).toBe('done');
    expect(issue).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it('not_started means nothing happened: failed with Start again', async () => {
    status.mockResolvedValue({ status: 'not_started', operationId: OP });
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('failed');
    expect(result.current.canStartAgain).toBe(true);
  });

  it('keeps polling through a transient read failure', async () => {
    status.mockRejectedValueOnce(fail(undefined, 'offline'));
    status.mockResolvedValueOnce({ status: 'confirmed', operationId: OP });
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('polling');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.step).toBe('done');
  });

  it('stops on an unknown operation with the server text', async () => {
    status.mockRejectedValue(
      fail('CANCEL_NOT_FOUND', 'We could not find this.')
    );
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('failed');
    expect(result.current.message).toBe('We could not find this.');
    expect(result.current.canStartAgain).toBe(true);
  });

  it('stops polling on unmount', async () => {
    const { result, unmount } = setup();
    await start(result);
    unmount();
    const calls = status.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(status).toHaveBeenCalledTimes(calls);
  });

  it('drops the attempt when the signed-in account changes', async () => {
    const { result } = setup();
    await start(result);
    const calls = status.mock.calls.length;
    act(() => {
      useAuthStore.setState({ user: { id: 'user-b' } as never });
    });
    expect(result.current.step).toBe('review');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(status).toHaveBeenCalledTimes(calls);
  });
});
