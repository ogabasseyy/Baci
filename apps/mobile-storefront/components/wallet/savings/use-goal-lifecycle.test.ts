import { act } from '@testing-library/react-native';
import {
  fail,
  GOAL,
  installLifecycleHarness,
  issue,
  MERCHANT,
  OP,
  PROOF,
  requestProof,
  run,
  setup,
  start,
  status,
  submit,
  takeInvalid,
} from './use-goal-lifecycle.test-support';

jest.mock('@/lib/goal-lifecycle-api');
jest.mock('./use-wallet-pin-prompt');

installLifecycleHarness();

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
