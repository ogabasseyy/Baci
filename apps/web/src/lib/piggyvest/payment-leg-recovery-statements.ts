export const PAYMENT_LEG_RECOVERY_STATEMENTS = {
  paymentLegRecoveryRead: {
    text: 'SELECT piggyvest_purchase_preparation.read_payment_leg_recovery($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid,$8::uuid) AS result',
    parameters: 8,
    roles: ['piggyvest_staging_policy_writer'],
  },
  paymentLegRecoveryObserve: {
    text: 'SELECT piggyvest_purchase_preparation.observe_payment_leg_recovery($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid,$8::jsonb) AS result',
    parameters: 8,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
