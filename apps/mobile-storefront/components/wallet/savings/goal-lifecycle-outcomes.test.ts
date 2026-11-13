import { messageOf, NOT_STARTABLE_CODES } from './goal-lifecycle-outcomes';

describe('bugfix: a goal whose PiggyVest setup never finished showed a generic error and Start again', () => {
  it("shows the server's explanation and never offers Start again", () => {
    const error = Object.assign(
      new Error(
        "This plan is still being set up, so there's nothing to cancel yet."
      ),
      { code: 'GOAL_NOT_SET_UP' }
    );
    expect(messageOf(error)).toBe(
      "This plan is still being set up, so there's nothing to cancel yet."
    );
    expect(NOT_STARTABLE_CODES).toContain('GOAL_NOT_SET_UP');
  });
});

it('shows the PIN step answer for an attempt that is no longer valid', () => {
  for (const [code, text] of [
    [
      'CANCEL_OPERATION_INVALID',
      'This cancellation is no longer valid. Please start again.',
    ],
    [
      'COMPLETE_OPERATION_INVALID',
      'This completion is no longer valid. Please start again.',
    ],
  ]) {
    expect(messageOf(Object.assign(new Error(text), { code }))).toBe(text);
  }
});
