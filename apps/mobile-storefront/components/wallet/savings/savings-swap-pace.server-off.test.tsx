import { savingsSwapPace } from './savings-swap-pace';

const now = new Date('2026-11-13T10:00:00Z');

// Pure arithmetic: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: savingsSwapPace', () => {
  it('quotes a monthly plan per month, not per week', () => {
    const pace = savingsSwapPace({
      frequency: 'monthly',
      maturityDate: '2027-11-13',
      now,
      remaining: 120_000,
    });
    expect(pace?.unit).toBe('a month');
    // About twelve months left: roughly ₦10,000 each.
    expect(pace?.amount).toBeGreaterThanOrEqual(10_000);
    expect(pace?.amount).toBeLessThan(10_100);
  });

  it('quotes a weekly plan per week', () => {
    expect(
      savingsSwapPace({
        frequency: 'weekly',
        maturityDate: '2026-12-11',
        now,
        remaining: 40_000,
      })
    ).toEqual({ amount: 10_000, unit: 'a week' });
  });

  it('gives nothing without a future end date or anything left', () => {
    const base = { frequency: 'daily' as const, now };
    expect(
      savingsSwapPace({ ...base, maturityDate: '2026-11-01', remaining: 5 })
    ).toBeNull();
    expect(
      savingsSwapPace({ ...base, maturityDate: '2027-01-01', remaining: 0 })
    ).toBeNull();
    expect(
      savingsSwapPace({ ...base, maturityDate: null, remaining: 5 })
    ).toBeNull();
  });
});
