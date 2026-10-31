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
  release:
    'SELECT piggyvest_primary.release_onboarding_intent($1::jsonb, $2::uuid, $3::uuid) AS result',
  // A created wallet whose interest routing is not proven yet: ids kept,
  // never usable, re-read read-only until resolved (20261031230000).
  routingPending:
    'SELECT piggyvest_primary.record_onboarding_routing_pending($1::jsonb, $2::uuid, $3::uuid, $4::text, $5::text) AS result',
  readRouting:
    'SELECT piggyvest_primary.read_onboarding_routing($1::jsonb) AS result',
  resolveRouting:
    'SELECT piggyvest_primary.resolve_onboarding_routing($1::jsonb, $2::jsonb, $3::boolean) AS result',
} as const;
