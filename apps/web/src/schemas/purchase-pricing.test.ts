import { describe, expect, it } from 'vitest';
import { purchasePricingSchemas } from './purchase-pricing';

const uuid = '00000000-0000-4000-8000-000000000000';

describe('purchasePricingSchemas', () => {
  it('accepts a valid pricing input', () => {
    expect(
      purchasePricingSchemas.input.safeParse({
        quoteId: uuid,
        shippingRateId: uuid,
        savingsKobo: 800,
      }).success
    ).toBe(true);
  });

  it('rejects a non-positive savings amount', () => {
    expect(
      purchasePricingSchemas.input.safeParse({
        quoteId: uuid,
        shippingRateId: uuid,
        savingsKobo: 0,
      }).success
    ).toBe(false);
  });

  it('requires exactly one result row', () => {
    expect(purchasePricingSchemas.rows.safeParse([]).success).toBe(false);
    expect(
      purchasePricingSchemas.rows.safeParse([{ result: null }]).success
    ).toBe(false);
  });
});
