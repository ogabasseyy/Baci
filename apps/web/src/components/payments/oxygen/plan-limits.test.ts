import { expect, it } from 'vitest';
import { oxygenPlanLimits } from './plan-limits';

it('finds the first and last selectable percentages using kobo rounding', () => {
  expect(oxygenPlanLimits(198000, 60000, 10000)).toEqual({
    kind: 'available',
    min: 69.7,
    max: 90,
  });
  expect(oxygenPlanLimits(40000, 25000, 10000)).toEqual({
    kind: 'available',
    min: 37.5,
    max: 75,
  });
  expect(oxygenPlanLimits(100.01, 75, 1)).toEqual({
    kind: 'available',
    min: 25.01,
    max: 90,
  });
  expect(oxygenPlanLimits(100000, 60000, 60000)).toEqual({
    kind: 'available',
    min: 40,
    max: 40,
  });
});

it('does not invent a plan for an impossible or missing provider limit', () => {
  expect(oxygenPlanLimits(10000, 10000, 10000)).toEqual({
    kind: 'unavailable',
  });
  expect(oxygenPlanLimits(10000.01, 10000, 10000)).toEqual({
    kind: 'unavailable',
  });
  expect(oxygenPlanLimits(198000, undefined, 10000)).toEqual({
    kind: 'unknown',
  });
  expect(oxygenPlanLimits(198000, 60000, -1)).toEqual({ kind: 'unknown' });
});
