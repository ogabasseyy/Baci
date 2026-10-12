export const PURCHASE_PREPARATION_STATEMENTS = {
  purchaseQuote: {
    text: 'SELECT piggyvest_purchase_preparation.quote($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
  purchasePrepare: {
    text: 'SELECT piggyvest_purchase_preparation.prepare($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::jsonb) AS result',
    parameters: 6,
    roles: ['piggyvest_staging_policy_writer'],
  },
  purchaseStatus: {
    text: 'SELECT piggyvest_purchase_preparation.status($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
