export const PIGGYVEST_ACCRUAL_REPLAY_STATEMENT = {
  text: 'SELECT piggyvest_staging.record_interest_accrual($1::uuid,$2::text,$3::text,$4::uuid,$5::text,$6::json) AS result',
  parameters: 6,
} as const;
