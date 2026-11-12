import { GOAL_LIFECYCLE_COPY } from './goal-lifecycle-outcomes';

describe('bugfix: the cancel copy promised the interest back', () => {
  it('never tells the customer an early cancel returns the interest', () => {
    const { reviewBody, successBody } = GOAL_LIFECYCLE_COPY.cancel;
    for (const text of [reviewBody, successBody]) {
      expect(text).not.toMatch(/including interest/i);
      expect(text).not.toMatch(/whole goal balance/i);
      expect(text).toMatch(/interest .* not refunded/i);
    }
  });

  it('keeps the complete copy, which does move the interest', () => {
    expect(GOAL_LIFECYCLE_COPY.complete.reviewBody).toMatch(
      /including interest already paid into it/
    );
  });
});
