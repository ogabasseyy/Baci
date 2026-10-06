import { safeRemainingKobo } from './safe-remaining-kobo';

it('rounds the remaining 0.30 minus 0.20 naira to ten kobo', () => {
  expect(safeRemainingKobo(0.3 - 0.2)).toBe(10);
});

it.each([
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -1,
  0,
  Number.MAX_VALUE,
  Number.MAX_SAFE_INTEGER,
])('fails closed for an invalid or unsafe remaining amount %s', (amount) => {
  expect(safeRemainingKobo(amount)).toBe(0);
});

it.each([
  [0.004, 0],
  [0.006, 1],
  [12.34, 1234],
])('rounds %s naira to %s integer kobo', (amount, expected) => {
  expect(safeRemainingKobo(amount)).toBe(expected);
});
