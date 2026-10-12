export const RECONCILIATION_CASES_STATEMENTS = {
  readReconciliationCase: {
    text: 'SELECT piggyvest_reconciliation_cases.read($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
  listReconciliationCases: {
    text: 'SELECT piggyvest_reconciliation_cases.list($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
