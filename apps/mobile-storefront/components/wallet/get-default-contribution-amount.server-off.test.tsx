import { getDefaultContributionAmount } from './get-default-contribution-amount';

it('defaults to a modest contribution capped by funds and remaining goal', () => {
  expect(
    getDefaultContributionAmount({ available: 40055, remaining: 250000 })
  ).toBe(1000);
  expect(
    getDefaultContributionAmount({ available: 1000, remaining: 250000 })
  ).toBe(1000);
  expect(
    getDefaultContributionAmount({ available: 90000, remaining: 4000 })
  ).toBe(1000);
  expect(
    getDefaultContributionAmount({ available: 1500.75, remaining: 9000 })
  ).toBe(1000);
  expect(
    getDefaultContributionAmount({ available: 90000, remaining: 400 })
  ).toBe(400);
});

it('returns no default for empty funds, a full goal, or invalid funds', () => {
  expect(getDefaultContributionAmount({ available: 0, remaining: 1000 })).toBe(
    0
  );
  expect(getDefaultContributionAmount({ available: 5000, remaining: 0 })).toBe(
    0
  );
  expect(getDefaultContributionAmount({ available: -5, remaining: 100 })).toBe(
    0
  );
});

it('keeps the full wallet amount opt-in', () => {
  expect(
    getDefaultContributionAmount({ available: 40055, remaining: 250000 })
  ).toBe(1000);
});
