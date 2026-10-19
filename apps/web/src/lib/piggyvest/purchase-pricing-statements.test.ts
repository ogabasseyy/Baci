import { expect, it } from 'vitest';
import { PURCHASE_PRICING_STATEMENTS } from './purchase-pricing-statements';

it('permits only the exact six-parameter restricted publisher', () => {
  expect(Object.keys(PURCHASE_PRICING_STATEMENTS)).toEqual(['purchasePublish']);
  expect(PURCHASE_PRICING_STATEMENTS.purchasePublish).toEqual({
    text: 'SELECT piggyvest_purchase_pricing.publish($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::jsonb) AS result',
    parameters: 6,
    roles: ['piggyvest_staging_policy_writer'],
  });
});
