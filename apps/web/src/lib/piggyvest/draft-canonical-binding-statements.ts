export const DRAFT_CANONICAL_BINDING_STATEMENTS = {
  bindCanonicalDraft: {
    text: 'SELECT savings_draft_private.bind_canonical($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid,$8::uuid,$9::uuid) AS result',
    parameters: 9,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
