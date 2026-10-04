import { formatSavingsDuration } from './format-savings-duration';

describe('savings preview duration', () => {
  it.each([
    ['daily', '3 days'],
    ['weekly', '3 weeks'],
    ['monthly', '3 months'],
  ] as const)('matches the first contribution on the start date for %s', (frequency, expected) => {
    expect(formatSavingsDuration(100, 25, frequency)).toBe(expected);
  });
  it('handles a final partial contribution and singular period', () => {
    expect(formatSavingsDuration(100, 60, 'monthly')).toBe('1 month');
  });
  it('shows same-day completion when one contribution reaches the target', () => {
    expect(formatSavingsDuration(100, 100, 'daily')).toBe('Same day');
  });
  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('does not invent a duration for invalid contribution %s', (contribution) => {
    expect(formatSavingsDuration(100, contribution, 'daily')).toBe('—');
  });
});
