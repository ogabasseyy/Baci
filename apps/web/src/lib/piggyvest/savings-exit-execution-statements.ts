export const SAVINGS_EXIT_EXECUTION_STATEMENTS = {
  exitConsumeEvidence: {
    text: 'SELECT piggyvest_savings_exit_execution.consume_evidence($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid,$8::text) AS result',
    parameters: 8,
    roles: ['piggyvest_staging_policy_writer'],
  },
  begin: {
    text: 'SELECT piggyvest_savings_exit_execution.begin($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid,$8::text,$9::jsonb) AS result',
    parameters: 9,
    roles: ['piggyvest_staging_policy_writer'],
  },
  recordFinality: {
    text: 'SELECT piggyvest_savings_exit_execution.record_finality($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid,$8::jsonb) AS result',
    parameters: 8,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
