import { getContributionCap } from './get-contribution-cap';

it('caps a contribution to the whole naira amount both available and needed', () => {
  expect(getContributionCap(1500.75, 2000)).toBe(1500);
  expect(getContributionCap(5000, 700)).toBe(700);
});

it('rejects empty, negative, and unsafe caps', () => {
  expect(getContributionCap(0, 100)).toBe(0);
  expect(getContributionCap(-1, 100)).toBe(0);
  expect(
    getContributionCap(Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY)
  ).toBe(0);
});
