import { describe, expect, it } from '@jest/globals';
import {
  type SavingsGoalData,
  toActiveSavingsGoal,
} from './wallet-savings-data';

const completedGoal = {
  contribution_amount: '10',
  contribution_frequency: 'weekly',
  current_amount: '100',
  id: 'goal-1',
  maturity_date: '2026-09-30',
  product_id: 'product-1',
  source_mode: 'manual',
  status: 'completed',
  target_amount: '100',
  title: 'Device',
  variant_id: null,
} satisfies SavingsGoalData;

function resolve(
  price: unknown,
  priceOverride: unknown,
  goal: SavingsGoalData = completedGoal
) {
  return toActiveSavingsGoal({
    goal,
    product: {
      id: 'product-1',
      name: 'Device',
      price,
      variants: [
        { id: 'variant-1', name: '256GB', price_override: priceOverride },
      ],
    },
  });
}

describe('bugfix: variant override does not require a valid base price', () => {
  it.each([
    undefined,
    null,
    '',
    'invalid',
    'NaN',
    'Infinity',
    0,
    -1,
  ])('offers the affordable variant with a valid override when base price is %p', (price) => {
    expect(resolve(price, '100')?.variant_resolution_options).toEqual([
      { id: 'variant-1', label: '256GB' },
    ]);
  });

  it.each([
    undefined,
    null,
    '',
    'invalid',
    'NaN',
    'Infinity',
    0,
    -1,
  ])('rejects a variant when its override is %p and the base price is invalid', (priceOverride) => {
    expect(
      resolve('invalid', priceOverride)?.variant_resolution_options
    ).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    'invalid',
  ])('preserves valid base fallback for override %p', (priceOverride) => {
    expect(resolve('90', priceOverride)?.variant_resolution_options).toEqual([
      { id: 'variant-1', label: '256GB' },
    ]);
  });

  it.each([
    0,
    -1,
    '',
    '101',
  ])('does not replace an explicit disallowed override %p with an affordable base', (priceOverride) => {
    expect(
      resolve('90', priceOverride)?.variant_resolution_options
    ).toBeUndefined();
  });

  it.each([
    { current_amount: '99' },
    { target_amount: '99' },
    { current_amount: '0' },
    { target_amount: '-1' },
    { current_amount: 'Infinity' },
    { target_amount: 'NaN' },
  ])('rejects an override outside the valid savings limit %j', (amounts) => {
    expect(
      resolve(null, '100', { ...completedGoal, ...amounts })
        ?.variant_resolution_options
    ).toBeUndefined();
  });
});
