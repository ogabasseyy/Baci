export const PERIOD_RECOVERY_STATEMENTS = {
  readPeriodRecovery: {
    text: 'SELECT piggyvest_period_recovery.read($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
  recordPeriodRecovery: {
    text: 'SELECT piggyvest_period_recovery.record($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
