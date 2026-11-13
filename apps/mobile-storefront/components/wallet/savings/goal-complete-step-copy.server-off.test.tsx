import { GOAL_COMPLETE_STEP_COPY as COPY } from './goal-complete-step-copy';

describe('complete step copy', () => {
  it('names the goal and the amount in the done message', () => {
    expect(COPY.subtitle('iPhone 15')).toBe('Your iPhone 15 is fully saved.');
    expect(COPY.doneBody('₦10', 'iPhone 15')).toBe(
      '₦10 is in your wallet. Our team will contact you soon to finish your iPhone 15 order.'
    );
  });

  it('never says anything is paid out to a bank', () => {
    const text = JSON.stringify(COPY).toLowerCase();
    expect(text).not.toContain('bank');
    expect(text).not.toContain('withdraw');
  });
});
