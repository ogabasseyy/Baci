export const PROTECTED_OFFER_STATEMENTS = {
  publishProtectedOffer: {
    text: 'SELECT piggyvest_protected_offer.publish($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
  readProtectedOffer: {
    text: 'SELECT piggyvest_protected_offer.read($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
