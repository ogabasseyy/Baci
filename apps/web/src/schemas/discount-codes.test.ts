import { describe, expect, it } from 'vitest';
import {
  createDiscountCodeSchema,
  updateDiscountCodeSchema,
} from './discount-codes';

describe('discount code schemas', () => {
  it('applies create defaults for omitted targeting and limits', () => {
    const result = createDiscountCodeSchema.parse({
      code: ' save10 ',
      discount_type: 'percentage',
      discount_value: 10,
    });

    expect(result).toMatchObject({
      code: 'SAVE10',
      minimum_purchase_amount: 0,
      usage_limit_per_customer: 1,
      is_active: true,
      applies_to: 'all',
      product_ids: [],
      category_ids: [],
    });
  });

  it('keeps sparse updates from materializing create defaults', () => {
    const result = updateDiscountCodeSchema.parse({
      description: 'Seasonal sale',
    });

    expect(result).toEqual({
      description: 'Seasonal sale',
    });
  });

  it('keeps an empty update as a no-op payload', () => {
    expect(updateDiscountCodeSchema.parse({})).toEqual({});
  });

  it('accepts a resent RDM code on update', () => {
    // Grandfathering: the reservation is enforced on actual code
    // changes (call site + DB trigger), not at update parse time.
    const result = updateDiscountCodeSchema.safeParse({
      code: 'RDM-LEGACY-01',
    });

    expect(result.success).toBe(true);
  });

  it('still validates targeting relationships when applies_to changes', () => {
    const result = updateDiscountCodeSchema.safeParse({
      applies_to: 'specific_products',
    });

    expect(result.success).toBe(false);
  });

  it.each([
    'RDM-ABCDEF12',
    'rdm-abcdef12',
    ' Rdm-X ',
  ])('rejects the reserved loyalty prefix in %s', (code) => {
    const result = createDiscountCodeSchema.safeParse({
      code,
      discount_type: 'percentage',
      discount_value: 10,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('RDM-');
    }
  });
});
