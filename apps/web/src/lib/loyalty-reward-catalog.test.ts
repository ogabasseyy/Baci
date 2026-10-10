import { describe, expect, it } from 'vitest';
import {
  type PersistedReward,
  toCatalogReward,
} from './loyalty-reward-catalog';

function reward(overrides: Partial<PersistedReward> = {}): PersistedReward {
  return {
    id: 'r-1',
    name: 'Reward',
    description: null,
    points_cost: 100,
    reward_type: 'free_shipping',
    reward_value: null,
    ...overrides,
  };
}

describe('toCatalogReward', () => {
  it('passes catalog types through without a discount type', () => {
    expect(toCatalogReward(reward({ reward_type: 'free_shipping' }))).toEqual({
      reward_type: 'free_shipping',
      discount_type: undefined,
    });
  });

  it('folds persisted discount variants into discount with a type', () => {
    expect(
      toCatalogReward(reward({ reward_type: 'discount_percentage' }))
    ).toEqual({ reward_type: 'discount', discount_type: 'percentage' });
    expect(toCatalogReward(reward({ reward_type: 'discount_fixed' }))).toEqual({
      reward_type: 'discount',
      discount_type: 'fixed',
    });
  });

  it('falls back to a plain discount for unknown types', () => {
    expect(toCatalogReward(reward({ reward_type: 'store_credit' }))).toEqual({
      reward_type: 'discount',
      discount_type: undefined,
    });
  });
});
