import { getSavingsPace } from './get-savings-pace';

const now = new Date('2026-11-12T10:00:00Z');

describe('getSavingsPace', () => {
  it('uses the plan contribution and frequency with its end date', () => {
    expect(
      getSavingsPace({
        contributionAmount: 2000,
        frequency: 'daily',
        maturityDate: '2027-03-17',
        now,
        remaining: 250000,
      })
    ).toEqual({
      short: '₦2,000 a day · until 17 Mar 2027',
      // The plan's pace and end date, never a promise to finish by then.
      label: '₦2,000 a day until 17 Mar 2027',
    });
  });

  it.each([
    ['weekly', 'a week'],
    ['monthly', 'a month'],
  ] as const)('words the %s frequency plainly', (frequency, words) => {
    expect(
      getSavingsPace({
        contributionAmount: 5000,
        frequency,
        maturityDate: null,
        now,
        remaining: 250000,
      })
    ).toEqual({ short: `₦5,000 ${words}`, label: `₦5,000 ${words}` });
  });

  it('never asks for more than is left to save', () => {
    expect(
      getSavingsPace({
        contributionAmount: 10000,
        frequency: 'weekly',
        maturityDate: null,
        now,
        remaining: 1500,
      })?.short
    ).toBe('₦1,500 a week');
  });

  it('falls back to the weekly pace from the end date without a plan pace', () => {
    expect(
      getSavingsPace({
        contributionAmount: 0,
        frequency: 'daily',
        maturityDate: '2026-12-10',
        now,
        remaining: 40000,
      })?.short
    ).toBe('₦10,000 a week · until 10 Dec 2026');
  });

  it('returns nothing when nothing is left or there is no pace at all', () => {
    expect(
      getSavingsPace({
        contributionAmount: 2000,
        frequency: 'daily',
        maturityDate: '2027-01-01',
        now,
        remaining: 0,
      })
    ).toBeNull();
    expect(
      getSavingsPace({
        contributionAmount: null,
        frequency: null,
        maturityDate: null,
        now,
        remaining: 1000,
      })
    ).toBeNull();
  });

  describe('bugfix: the wallet kept an end date the pace could not meet', () => {
    it('shows the pace alone when the plan is behind schedule', () => {
      expect(
        getSavingsPace({
          contributionAmount: 2000,
          frequency: 'daily',
          maturityDate: '2026-11-20',
          now,
          remaining: 250000,
        })
      ).toEqual({ short: '₦2,000 a day', label: '₦2,000 a day' });
    });
  });
});
