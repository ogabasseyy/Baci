import { describe, expect, it } from '@jest/globals';
import type { SavingsGoalData } from './wallet-savings-data';
import { toActiveSavingsGoal } from './wallet-savings-data';

const completedUnresolvedGoal = {
  contribution_amount: 10000,
  contribution_frequency: 'weekly',
  current_amount: 500000,
  id: 'goal-1',
  maturity_date: '2026-09-30',
  product_id: 'product-1',
  product_snapshot: {},
  source_mode: 'manual',
  status: 'completed',
  target_amount: 650000,
  title: 'iPhone 15 Pro',
  variant_id: null,
} satisfies SavingsGoalData;

describe('completed savings variant resolution projection', () => {
  it('offers only current non-anchor variants with valid prices within the persisted bound', () => {
    expect(
      toActiveSavingsGoal({
        goal: completedUnresolvedGoal,
        product: {
          id: 'product-1',
          images: [],
          name: 'iPhone 15 Pro',
          price: 600000,
          variants: [
            {
              attributes: { color: 'Black', storage: '256GB' },
              condition: 'new',
              id: 'eligible-variant',
              price_override: 500000,
            },
            {
              id: 'inventory-anchor',
              is_inventory_anchor: true,
              price_override: 600000,
            },
            {
              id: 'too-expensive',
              price_override: 700000,
            },
            {
              id: 'invalid-price',
              price_override: 0,
            },
          ],
        },
      })
    ).toEqual(
      expect.objectContaining({
        variant_resolution_options: [
          {
            id: 'eligible-variant',
            label: 'New · Color: Black · Storage: 256GB',
          },
        ],
      })
    );
  });

  it('does not offer resolution options for active or already-resolved goals', () => {
    const product = {
      id: 'product-1',
      images: [],
      name: 'iPhone 15 Pro',
      price: 600000,
      variants: [{ id: 'variant-1', price_override: 600000 }],
    };

    expect(
      toActiveSavingsGoal({
        goal: { ...completedUnresolvedGoal, status: 'active' },
        product,
      })?.variant_resolution_options
    ).toBeUndefined();
    expect(
      toActiveSavingsGoal({
        goal: { ...completedUnresolvedGoal, variant_id: 'variant-1' },
        product,
      })?.variant_resolution_options
    ).toBeUndefined();
  });
});
