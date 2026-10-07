export const PURCHASE_PRICING_STATEMENTS = {
  purchasePublish: {
    text: 'SELECT piggyvest_purchase_pricing.publish($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::jsonb) AS result',
    parameters: 6,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
