import { GOAL_COMPLETE_STEP_COPY as COPY } from './goal-complete-step-copy';

describe('complete step copy', () => {
  it('names the goal in the done message, never a stale amount', () => {
    expect(COPY.subtitle('iPhone 15')).toBe('Your iPhone 15 is fully saved.');
    expect(COPY.doneBodyUnknown('iPhone 15')).toBe(
      'Your savings are in your wallet. Our team will contact you soon to finish your iPhone 15 order.'
    );
  });

  it('never says anything is paid out to a bank', () => {
    const text = JSON.stringify(COPY).toLowerCase();
    expect(text).not.toContain('bank');
    expect(text).not.toContain('withdraw');
  });
});
