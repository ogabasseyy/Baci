import { daysUntil, getSavingsPace, paymentsThatFit } from './get-savings-pace';

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
      short: 'Your plan: ₦2,000 a day · until 17 Mar 2027',
      // The plan's pace and end date, never a promise to finish by then.
      label: 'Your plan: ₦2,000 a day until 17 Mar 2027',
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
    ).toEqual({
      short: `Your plan: ₦5,000 ${words}`,
      label: `Your plan: ₦5,000 ${words}`,
    });
  });

  it('keeps the plan pace even when less is left (the last payment is smaller)', () => {
    expect(
      getSavingsPace({
        contributionAmount: 10000,
        frequency: 'weekly',
        maturityDate: null,
        now,
        remaining: 1500,
      })?.short
    ).toBe('Your plan: ₦10,000 a week');
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
    it('says calmly that a behind plan needs a little more, without the date', () => {
      expect(
        getSavingsPace({
          contributionAmount: 2000,
          frequency: 'daily',
          maturityDate: '2026-11-20',
          now,
          remaining: 250000,
        })
      ).toEqual({
        short: 'Your plan: ₦2,000 a day · add a little more to finish on time',
        label: 'Your plan: ₦2,000 a day, add a little more to finish on time',
      });
    });
  });

  describe('end-date boundary (exact days, today counts as one payment)', () => {
    // now = 2026-11-12; 7 days to 2026-11-19 fit 8 daily payments.
    it('keeps the date when the payments exactly fit', () => {
      expect(
        getSavingsPace({
          contributionAmount: 1000,
          frequency: 'daily',
          maturityDate: '2026-11-19',
          now,
          remaining: 8000,
        })?.short
      ).toBe('Your plan: ₦1,000 a day · until 19 Nov 2026');
    });

    it('drops the date when one more payment is needed than fits', () => {
      expect(
        getSavingsPace({
          contributionAmount: 1000,
          frequency: 'daily',
          maturityDate: '2026-11-19',
          now,
          remaining: 9000,
        })?.short
      ).toBe('Your plan: ₦1,000 a day · add a little more to finish on time');
    });
  });

  describe('calendar-aware payment counting', () => {
    it('counts calendar months for monthly plans', () => {
      // 12 Nov 2026 -> 12 Feb 2027 is 3 calendar months: 4 payments fit.
      expect(paymentsThatFit('monthly', '2027-02-12', now)).toBe(4);
      // One day short of the third month: 3 payments fit.
      expect(paymentsThatFit('monthly', '2027-02-11', now)).toBe(3);
    });

    it('counts a month-end payment into a shorter month (31 Jan -> 28 Feb)', () => {
      const jan31 = new Date(2027, 0, 31, 10);
      expect(paymentsThatFit('monthly', '2027-02-28', jan31)).toBe(2);
      expect(paymentsThatFit('monthly', '2027-02-27', jan31)).toBe(1);
    });

    it('uses the phone’s own day, not the UTC day', () => {
      const lateLocal = new Date(2026, 10, 12, 23, 30);
      expect(paymentsThatFit('daily', '2026-11-13', lateLocal)).toBe(2);
    });
  });

  describe('bugfix: an impossible stored date rolled into the next month', () => {
    it('treats a date that is not a real calendar day as unusable', () => {
      const now = new Date(2027, 0, 10);
      expect(daysUntil('2027-02-30', now)).toBeNull();
      expect(paymentsThatFit('daily', '2027-02-30', now)).toBe(0);
      expect(daysUntil('2027-02-28', now)).toBe(49);
    });
  });

  describe('bugfix: an impossible end date was called "behind"', () => {
    it('shows the plan pace alone when the stored date is not a real day', () => {
      expect(
        getSavingsPace({
          contributionAmount: 100,
          frequency: 'monthly',
          maturityDate: '2027-02-30',
          now,
          remaining: 250000,
        })
      ).toEqual({
        short: 'Your plan: ₦100 a month',
        label: 'Your plan: ₦100 a month',
      });
    });
  });

  describe('bugfix: a plan due today that still needs more showed only its pace', () => {
    it('warns on the end date itself when more than one payment is left', () => {
      expect(
        getSavingsPace({
          contributionAmount: 1000,
          frequency: 'daily',
          maturityDate: '2026-11-12',
          now,
          remaining: 5000,
        })?.short
      ).toBe('Your plan: ₦1,000 a day · add a little more to finish on time');
    });
  });
});
