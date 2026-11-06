import {
  getDefaultContributionAmount,
  getQuickAmountOptions,
  getSavingsEncouragement,
  getWeeklySavingsNudge,
} from './savings-encouragement';

describe('getSavingsEncouragement', () => {
  it.each([
    [0, 'Every naira counts'],
    [1, 'Great start!'],
    [24, 'Great start!'],
    [25, 'A quarter of the way!'],
    [50, 'Halfway there!'],
    [75, 'Almost there!'],
    [99, 'Almost there!'],
    [100, 'Goal reached!'],
  ])('at %i percent says "%s"', (percent, title) => {
    expect(getSavingsEncouragement(percent).title).toBe(title);
  });

  it('invites any amount at zero and never mentions interest or returns', () => {
    expect(getSavingsEncouragement(0).body).toBe('Start with any amount.');
    for (const percent of [0, 10, 30, 60, 80, 100]) {
      const { body, title } = getSavingsEncouragement(percent);
      expect(`${title} ${body}`).not.toMatch(/interest|return|earn|profit/i);
    }
  });
});

describe('getWeeklySavingsNudge', () => {
  const now = new Date('2026-11-05T10:00:00Z');

  it('spreads what is left over the whole weeks until the goal date', () => {
    // 28 days = 4 weeks; 100,000 / 4 = 25,000 a week.
    const nudge = getWeeklySavingsNudge({
      maturityDate: '2026-12-03',
      now,
      remaining: 100000,
    });
    expect(nudge?.weeks).toBe(4);
    expect(nudge?.amountPerWeek).toBe(25000);
    expect(nudge?.label).toMatch(
      /^Save about ₦25,000 a week to reach this by /
    );
  });

  it('uses the actual time remaining instead of rounding a partial week up', () => {
    const nudge = getWeeklySavingsNudge({
      maturityDate: '2026-11-13',
      now,
      remaining: 1001,
    });
    expect(nudge?.weeks).toBe(2);
    expect(nudge?.amountPerWeek).toBe(876);
  });

  it('uses at least one week when the date is very close', () => {
    expect(
      getWeeklySavingsNudge({
        maturityDate: '2026-11-06',
        now,
        remaining: 7000,
      })?.amountPerWeek
    ).toBe(7000);
  });

  it.each([
    ['no date', undefined],
    ['an empty date', ''],
    ['an unreadable date', 'soon'],
    ['today', '2026-11-05'],
    ['a past date', '2026-10-01'],
  ])('skips the nudge for %s', (_name, maturityDate) => {
    expect(
      getWeeklySavingsNudge({ maturityDate, now, remaining: 5000 })
    ).toBeNull();
  });

  it('skips the nudge when nothing is left to save', () => {
    expect(
      getWeeklySavingsNudge({
        maturityDate: '2027-01-01',
        now,
        remaining: 0,
      })
    ).toBeNull();
  });
});

describe('quick amounts', () => {
  it('defaults to the smaller of the wallet balance and what is left', () => {
    expect(
      getDefaultContributionAmount({ available: 1000, remaining: 250000 })
    ).toBe(1000);
    expect(
      getDefaultContributionAmount({ available: 90000, remaining: 4000 })
    ).toBe(4000);
    expect(
      getDefaultContributionAmount({ available: 1500.75, remaining: 9000 })
    ).toBe(1500);
  });

  it('has no default when the wallet is empty or the goal is full', () => {
    expect(
      getDefaultContributionAmount({ available: 0, remaining: 5000 })
    ).toBe(0);
    expect(
      getDefaultContributionAmount({ available: 5000, remaining: 0 })
    ).toBe(0);
    expect(
      getDefaultContributionAmount({ available: -5, remaining: 100 })
    ).toBe(0);
  });

  it('offers fixed amounts that fit plus all available, never above what is left', () => {
    const options = getQuickAmountOptions({ available: 1000, remaining: 6000 });
    expect(options).toEqual([
      { amount: 5000, label: '₦5,000' },
      { amount: 1000, label: 'All available' },
    ]);
    for (const option of options)
      expect(option.amount).toBeLessThanOrEqual(6000);
  });

  it('drops chips larger than the remaining amount', () => {
    const options = getQuickAmountOptions({ available: 400, remaining: 800 });
    expect(options).toEqual([{ amount: 400, label: 'All available' }]);
  });

  it('offers the rest of the goal when the wallet holds more than is needed', () => {
    const options = getQuickAmountOptions({
      available: 90000,
      remaining: 7000,
    });
    expect(options.at(-1)).toEqual({ amount: 7000, label: 'Reach goal' });
    expect(options.map((o) => o.amount)).toEqual([1000, 5000, 7000]);
  });

  it('shows no chips with nothing left to save', () => {
    expect(getQuickAmountOptions({ available: 5000, remaining: 0 })).toEqual(
      []
    );
  });
});
