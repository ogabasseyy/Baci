export const SAVINGS_EXIT_EVIDENCE_STATEMENTS = {
  exitRecordEvidence: {
    text: 'SELECT piggyvest_savings_exit_execution.record_evidence($1::uuid,$2::jsonb) AS result',
    parameters: 2,
    roles: ['piggyvest_exit_evidence_writer'],
  },
} as const;
