import { submitFailure } from './goal-submit-failure';

const err = (code: string) => ({ code, message: `msg ${code}` });

// Pure mapping of server refusals: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: submitFailure', () => {
  it('holds a goal the server put on review', () => {
    expect(submitFailure('cancel', err('GOAL_NEEDS_REVIEW'))?.step).toBe(
      'needs_review'
    );
  });

  it('lets an expired or busy attempt start again', () => {
    expect(submitFailure('complete', err('COMPLETE_EXPIRED'))).toMatchObject({
      step: 'failed',
      canStartAgain: true,
    });
  });

  it('treats a rejection as final', () => {
    expect(submitFailure('cancel', err('CANCEL_REJECTED'))).toMatchObject({
      step: 'failed',
      canStartAgain: false,
    });
  });

  it('never decides on an unknown failure: money may have moved', () => {
    expect(submitFailure('cancel', err('SOMETHING_ELSE'))).toBeNull();
    expect(submitFailure('cancel', new Error('timeout'))).toBeNull();
  });
});
