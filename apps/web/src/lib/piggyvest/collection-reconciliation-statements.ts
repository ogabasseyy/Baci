export const COLLECTION_RECONCILIATION_STATEMENTS = {
  observeCollectionReconciliation: {
    text: 'SELECT piggyvest_collection_reconciliation.observe($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::jsonb) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
  readCollectionReconciliation: {
    text: 'SELECT piggyvest_collection_reconciliation.read($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid,$8::uuid) AS result',
    parameters: 8,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
