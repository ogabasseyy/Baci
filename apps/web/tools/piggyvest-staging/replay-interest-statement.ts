export const PIGGYVEST_INTEREST_REPLAY_STATEMENT = {
  text: 'SELECT piggyvest_savings_ledger.apply_interest_receipt($1::uuid,$2::text,$3::text,$4::jsonb,$5::text) AS result',
  parameters: 5,
} as const;
