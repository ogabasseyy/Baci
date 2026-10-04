export const PREFUNDED_CARD_CUSTOMER_STATEMENTS = {
  capabilities:
    'SELECT prefunded_card.customer_capabilities($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,$8::jsonb) AS result',
  request:
    'SELECT prefunded_card.customer_request($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,$8::jsonb) AS result',
  status:
    'SELECT prefunded_card.customer_status($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,$8::jsonb) AS result',
} as const;
