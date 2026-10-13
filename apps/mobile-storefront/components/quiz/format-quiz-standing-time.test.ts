import { formatQuizStandingTime } from './format-quiz-standing-time';

describe('formatQuizStandingTime', () => {
  it('shows hundredths for a sub-minute finish', () => {
    expect(formatQuizStandingTime(12.484)).toBe('12.48s');
  });

  it('shows minutes without losing hundredths', () => {
    expect(formatQuizStandingTime(120)).toBe('2:00.00');
  });

  it('carries rounded hundredths across a minute boundary', () => {
    expect(formatQuizStandingTime(59.999)).toBe('1:00.00');
    expect(formatQuizStandingTime(119.999)).toBe('2:00.00');
  });

  it('omits unavailable timing', () => {
    expect(formatQuizStandingTime(null)).toBeNull();
  });
});
