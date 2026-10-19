export const PURCHASE_CURRENT_RECOVERY_STATEMENTS = {
  purchaseCurrentRecovery: {
    text: 'SELECT piggyvest_purchase_preparation.read_current_recovery($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
