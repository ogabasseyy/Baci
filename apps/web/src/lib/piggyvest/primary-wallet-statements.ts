export const PRIMARY_WALLET_STATEMENTS = {
  read: 'SELECT piggyvest_primary.read_onboarding($1::jsonb) AS result',
  claim:
    'SELECT piggyvest_primary.claim_onboarding($1::jsonb, $2::text) AS result',
  record:
    'SELECT piggyvest_primary.record_onboarding($1::jsonb, $2::uuid, $3::uuid, $4::text, $5::text) AS result',
  uncertain:
    'SELECT piggyvest_primary.record_onboarding($1::jsonb, $2::uuid, $3::uuid, NULL::text, NULL::text) AS result',
  reject:
    'SELECT piggyvest_primary.record_onboarding_rejection($1::jsonb, $2::uuid, $3::uuid) AS result',
} as const;
