import { act } from '@testing-library/react-native';
import {
  fail,
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

const GENERIC = 'Something went wrong. Please try again.';

describe('a final answer while polling', () => {
  beforeEach(() => {
    issue.mockResolvedValue({ status: 'pending', operationId: OP });
  });

  it.each([
    [
      'cancel',
      'CANCEL_REJECTED',
      'This cancellation was not completed. Your savings are still in your goal.',
    ],
    [
      'complete',
      'COMPLETE_REJECTED',
      'This goal was not completed. Your savings are still in your goal.',
    ],
  ] as const)('%s: %s stops polling with a plain outcome', async (kind, code, message) => {
    status.mockRejectedValue(fail(code, 'PiggyVest did not accept it.'));
    const { result } = setup(kind);
    await start(result);
    expect(result.current.step).toBe('failed');
    expect(result.current.message).toBe(message);
    expect(result.current.canStartAgain).toBe(false);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(status).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps treating a timeout as indeterminate and never resubmits', async () => {
    status
      .mockRejectedValueOnce(fail(undefined, 'Request timed out'))
      .mockResolvedValueOnce({ status: 'confirmed', operationId: OP });
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('polling');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.step).toBe('done');
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('what the customer reads', () => {
  it.each([
    ['a network error', fail(undefined, 'Network request failed')],
    ['a parse error', new SyntaxError('Unexpected token < in JSON')],
    ['an unknown code', fail('SOMETHING_ELSE', 'select * from secrets')],
  ])('%s shows only the generic copy', async (_name, error) => {
    issue.mockRejectedValue(error);
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('failed');
    expect(result.current.message).toBe(GENERIC);
  });

  it('shows the server text for an unknown operation on a status read', async () => {
    issue.mockResolvedValue({ status: 'pending', operationId: OP });
    status.mockRejectedValue(fail('COMPLETE_NOT_FOUND', 'Not found text.'));
    const { result } = setup('complete');
    await start(result);
    expect(result.current.message).toBe('Not found text.');
  });
});

describe('codes that end the attempt before it starts', () => {
  it.each([
    'SAVINGS_NOT_READY',
    'PROFILE_VERIFICATION_REQUIRED',
    'SAVINGS_UNAVAILABLE',
    'UNAUTHORIZED',
    'GOAL_NOT_FOUND',
  ])('%s at issue offers no Start again and shows the server text', async (code) => {
    issue.mockRejectedValue(fail(code, `text for ${code}`));
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('failed');
    expect(result.current.message).toBe(`text for ${code}`);
    expect(result.current.canStartAgain).toBe(false);
  });

  it('UNAUTHORIZED sends the customer to sign in', async () => {
    issue.mockRejectedValue(fail('UNAUTHORIZED', 'Please sign in again.'));
    const { result } = setup();
    await start(result);
    expect(result.current.needsSignIn).toBe(true);
  });

  it('an ordinary refusal does not ask for a sign-in', async () => {
    issue.mockRejectedValue(fail('SAVINGS_NOT_READY', 'Not ready.'));
    const { result } = setup();
    await start(result);
    expect(result.current.needsSignIn).toBe(false);
  });

  it.each([
    'SAVINGS_NOT_READY',
    'PROFILE_VERIFICATION_REQUIRED',
    'SAVINGS_UNAVAILABLE',
    'UNAUTHORIZED',
  ])('%s at submit stops without polling', async (code) => {
    issue.mockResolvedValue({ status: 'issued', operationId: OP });
    requestProof.mockResolvedValue(PROOF);
    submit.mockRejectedValue(fail(code, `text for ${code}`));
    const { result } = setup();
    await start(result);
    expect(result.current.step).toBe('failed');
    expect(result.current.canStartAgain).toBe(false);
    expect(status).not.toHaveBeenCalled();
  });
});
