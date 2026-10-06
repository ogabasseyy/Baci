export const DRAFT_CLOSURE_STATEMENTS = {
  readDraftClosure: {
    text: 'SELECT piggyvest_draft_closure.read($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid) AS result',
    parameters: 6,
    roles: ['piggyvest_staging_policy_writer'],
  },
  closeUnfundedDraft: {
    text: 'SELECT piggyvest_draft_closure.close($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::jsonb) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
