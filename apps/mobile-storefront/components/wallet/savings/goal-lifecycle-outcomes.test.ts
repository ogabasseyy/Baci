import {
  GOAL_LIFECYCLE_COPY,
  messageOf,
  NOT_STARTABLE_CODES,
} from './goal-lifecycle-outcomes';

describe('bugfix: the cancel copy promised the interest back', () => {
  it('never tells the customer an early cancel returns the interest', () => {
    const { reviewBody, successBody } = GOAL_LIFECYCLE_COPY.cancel;
    for (const text of [reviewBody, successBody]) {
      expect(text).not.toMatch(/including interest/i);
      expect(text).not.toMatch(/whole goal balance/i);
      expect(text).toMatch(/interest .* not refunded/i);
      // True even for a goal that earned no interest.
      expect(text).toMatch(/any interest/i);
    }
  });

  it('keeps the complete copy, which does move the interest', () => {
    expect(GOAL_LIFECYCLE_COPY.complete.reviewBody).toMatch(
      /including interest already paid into it/
    );
  });
});

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
