import { GOAL_CANCEL_STEP_COPY as COPY } from './goal-cancel-step-copy';

// Owner rule (2026-11-12): an early cancel returns savings only. No cancel
// text may promise that interest comes back.
describe('cancel step copy', () => {
  it('names the goal in the question', () => {
    expect(COPY.title('iPhone 15 Pro')).toBe('Cancel iPhone 15 Pro?');
  });

  it('never says interest is returned', () => {
    const all = Object.values(COPY)
      .filter((value) => typeof value === 'string')
      .join(' ');
    expect(all).not.toMatch(/including interest/i);
    expect(COPY.interestForfeited).toMatch(/not refunded/);
    expect(COPY.forfeitNote).toMatch(/lose the interest/);
  });
});
