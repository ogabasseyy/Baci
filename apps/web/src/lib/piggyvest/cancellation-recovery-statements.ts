export const CANCELLATION_RECOVERY_STATEMENTS = {
  readCancellationRecovery: {
    text: 'SELECT piggyvest_cancel_plan.read_recovery($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
