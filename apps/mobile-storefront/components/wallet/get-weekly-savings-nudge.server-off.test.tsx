import { getWeeklySavingsNudge } from './get-weekly-savings-nudge';

const now = new Date('2026-11-05T10:00:00Z');

it('spreads the remaining goal amount across the actual time to maturity', () => {
  expect(
    getWeeklySavingsNudge({
      maturityDate: '2026-12-03',
      now,
      remaining: 100000,
    })
  ).toEqual({
    amountPerWeek: 25000,
    label: expect.stringMatching(
      /^Save about ₦25,000 a week to reach this by /
    ),
    weeks: 4,
  });
});

it('uses the actual remaining days for a partial week', () => {
  expect(
    getWeeklySavingsNudge({ maturityDate: '2026-11-13', now, remaining: 1001 })
  ).toEqual(expect.objectContaining({ amountPerWeek: 876, weeks: 2 }));
});

it('uses at least one week when the goal date is very close', () => {
  expect(
    getWeeklySavingsNudge({ maturityDate: '2026-11-06', now, remaining: 7000 })
      ?.amountPerWeek
  ).toBe(7000);
});

it.each([
  ['no date', undefined],
  ['an empty date', ''],
  ['an unreadable date', 'soon'],
  ['today', '2026-11-05'],
  ['a past date', '2026-10-01'],
])('skips the weekly nudge for %s', (_name, maturityDate) => {
  expect(
    getWeeklySavingsNudge({ maturityDate, now, remaining: 5000 })
  ).toBeNull();
});

it('skips the nudge when no amount remains', () => {
  expect(
    getWeeklySavingsNudge({ maturityDate: '2027-01-01', now, remaining: 0 })
  ).toBeNull();
});
