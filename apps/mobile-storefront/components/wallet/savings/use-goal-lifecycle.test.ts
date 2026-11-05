import { act, renderHook } from '@testing-library/react-native';
import {
  checkGoalActionStatus,
  issueGoalAction,
  submitGoalAction,
} from '@/lib/goal-lifecycle-api';
import { useAuthStore } from '@/stores/auth-store';
import { useGoalLifecycle } from './use-goal-lifecycle';
import { useWalletPinPrompt } from './use-wallet-pin-prompt';

jest.mock('@/lib/goal-lifecycle-api');
jest.mock('./use-wallet-pin-prompt');

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const GOAL = '22222222-2222-4222-8222-222222222222';
const OP = '33333333-3333-4333-8333-333333333333';
const PROOF = 'c'.repeat(64);
const fail = (code: string | undefined, message = `server says ${code}`) =>
  Object.assign(new Error(message), code ? { code } : {});

const requestProof = jest.fn();
const takeInvalid = jest.fn();
const issue = jest.mocked(issueGoalAction);
const submit = jest.mocked(submitGoalAction);
const status = jest.mocked(checkGoalActionStatus);

function setup(kind: 'cancel' | 'complete' = 'cancel') {
  return renderHook(() => useGoalLifecycle({ kind, goalId: GOAL }));
}
// Runs an action without waiting for it to finish: polling only ends when the
// fake clock is advanced.
async function run(action: () => Promise<void>) {
  await act(async () => {
    void action();
    await jest.advanceTimersByTimeAsync(0);
  });
}
async function start(result: { current: ReturnType<typeof useGoalLifecycle> }) {
  await run(() => result.current.begin());
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  takeInvalid.mockReturnValue(null);
  jest.mocked(useWalletPinPrompt).mockReturnValue({
    requestProof,
    takeInvalid,
    sheetProps: { request: null, onProof: jest.fn(), onCancel: jest.fn() },
  });
  act(() => {
    useAuthStore.setState({
      user: { id: 'user-a' } as never,
      merchantId: MERCHANT,
    });
  });
});
afterEach(() => jest.useRealTimers());

describe.each(['cancel', 'complete'] as const)('%s happy path', (kind) => {
  it('issues, asks for the PIN for that operation, submits once and is done', async () => {
    issue.mockResolvedValue({ status: 'issued', operationId: OP });
    requestProof.mockResolvedValue(PROOF);
    submit.mockResolvedValue({ status: 'confirmed', operationId: OP });
    const { result } = setup(kind);
    expect(result.current.step).toBe('review');
    await start(result);
    expect(issue).toHaveBeenCalledWith(
      kind,
      { merchantId: MERCHANT, goalId: GOAL },
      'user-a'
    );
    expect(requestProof).toHaveBeenCalledWith({
      action: kind,
      merchantId: MERCHANT,
      goalId: GOAL,
      operationId: OP,
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(
      kind,
      { merchantId: MERCHANT, goalId: GOAL, operationId: OP, pinProof: PROOF },
      'user-a'
    );
    expect(result.current.step).toBe('done');
  });
});

describe('issue answers', () => {
  it('goes straight to polling for a live attempt and never asks for a PIN', async () => {
    issue.mockResolvedValue({ status: 'pending', operationId: OP });
    status.mockResolvedValue({ status: 'confirmed', operationId: OP });
    const { result } = setup();
    await start(result);
    expect(requestProof).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(
      'cancel',
      { merchantId: MERCHANT, operationId: OP },
      'user-a'
    );
    expect(result.current.step).toBe('done');
  });

  it('treats an already-confirmed complete as done without any PIN', async () => {
    issue.mockResolvedValue({ status: 'confirmed', operationId: OP });
    const { result } = setup('complete');
    await start(result);
    expect(result.current.step).toBe('done');
    expect(requestProof).not.toHaveBeenCalled();
  });

  it('sends one issue for a double tap', async () => {
    let answer: (value: never) => void = () => undefined;
    issue.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve as never;
        })
    );
    const { result } = setup();
    act(() => {
      void result.current.begin();
      void result.current.begin();
    });
    expect(issue).toHaveBeenCalledTimes(1);
    expect(result.current.step).toBe('issuing');
    requestProof.mockResolvedValue(null);
    await act(async () => {
      answer({ status: 'issued', operationId: OP } as never);
    });
  });

  it.each([
    [
      'COMPLETE_NOT_ELIGIBLE',
      'This goal can be completed once it reaches its target or its end date.',
    ],
    ['GOAL_NOT_FOUND', 'We could not find this goal.'],
  ])('shows the server text verbatim for %s and offers no retry', async (code, message) => {
    issue.mockRejectedValue(fail(code, message));
    const { result } = setup('complete');
    await start(result);
    expect(result.current.step).toBe('failed');
    expect(result.current.message).toBe(message);
    expect(result.current.canStartAgain).toBe(false);
  });

  it('offers to start again after a busy answer', async () => {
    issue.mockRejectedValue(
      fail('CANCEL_BUSY', 'A contribution is still processing.')
    );
    const { result } = setup();
    await start(result);
    expect(result.current.message).toBe('A contribution is still processing.');
    expect(result.current.canStartAgain).toBe(true);
  });

  it('stops at needs-review with the server message and no retry', async () => {
    issue.mockRejectedValue(
      fail(
        'GOAL_NEEDS_REVIEW',
        'Your savings are safe. Please do not try again.'
      )
    );
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('needs_review');
    expect(result.current.message).toBe(
      'Your savings are safe. Please do not try again.'
    );
    expect(result.current.canStartAgain).toBe(false);
  });
});

describe('the PIN step', () => {
  beforeEach(() => {
    issue.mockResolvedValue({ status: 'issued', operationId: OP });
  });

  it('a closed sheet sends nothing; Try again asks for the PIN for the same operation', async () => {
    requestProof.mockResolvedValueOnce(null);
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('pin_cancelled');
    expect(submit).not.toHaveBeenCalled();
    requestProof.mockResolvedValueOnce(PROOF);
    submit.mockResolvedValue({ status: 'confirmed', operationId: OP });
    await run(() => result.current.retryPin());
    expect(issue).toHaveBeenCalledTimes(1);
    expect(requestProof).toHaveBeenLastCalledWith(
      expect.objectContaining({ operationId: OP })
    );
    expect(result.current.step).toBe('done');
  });

  it('an operation the sheet reports invalid goes back to review to start again', async () => {
    requestProof.mockResolvedValue(null);
    takeInvalid.mockReturnValue('This is no longer valid. Please start again.');
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('failed');
    expect(result.current.message).toBe(
      'This is no longer valid. Please start again.'
    );
    expect(result.current.canStartAgain).toBe(true);
    issue.mockResolvedValue({
      status: 'issued',
      operationId: '44444444-4444-4444-8444-444444444444',
    });
    requestProof.mockResolvedValue(PROOF);
    submit.mockResolvedValue({
      status: 'confirmed',
      operationId: '44444444-4444-4444-8444-444444444444',
    });
    await start(result);
    expect(issue).toHaveBeenCalledTimes(2);
    expect(result.current.step).toBe('done');
  });

  it('re-prompts once after PIN_PROOF_REFUSED then succeeds, with one issue', async () => {
    requestProof.mockResolvedValue(PROOF);
    submit
      .mockRejectedValueOnce(fail('PIN_PROOF_REFUSED'))
      .mockResolvedValueOnce({ status: 'confirmed', operationId: OP });
    const { result } = setup();
    await start(result);
    expect(requestProof).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(result.current.step).toBe('done');
  });

  it('a sheet closed during the re-prompt reads as cancelled', async () => {
    requestProof.mockResolvedValueOnce(PROOF).mockResolvedValueOnce(null);
    submit.mockRejectedValue(fail('PIN_PROOF_REQUIRED'));
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('pin_cancelled');
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

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
        'Your savings are safe. Please do not try again.'
      )
    );
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('needs_review');
    expect(result.current.message).toBe(
      'Your savings are safe. Please do not try again.'
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
