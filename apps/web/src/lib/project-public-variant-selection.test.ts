import { describe, expect, it } from 'vitest';
import { projectPublicVariantSelection } from './project-public-variant-selection';

describe('projectPublicVariantSelection', () => {
  it('projects strict eligibility even when the parent disables quantity tracking', () => {
    expect(
      projectPublicVariantSelection({ price: 100000, manage_stock: false }, [
        { inventory_tracking_policy: 'serialized_strict', stock_quantity: 0 },
        { inventory_tracking_policy: 'off', stock_quantity: 0 },
      ]).map((variant) => variant.is_purchasable)
    ).toEqual([false, true]);
  });
});
