export const PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS = {
  claim: {
    text: 'SELECT public.claim_piggyvest_transfer_outbox_submission($1::text, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::text, $7::bigint, $8::text, $9::text, $10::text, $11::text, $12::text, $13::text, $14::text) AS outcome',
    parameters: 14,
  },
  recordAccepted: {
    text: 'SELECT public.record_piggyvest_transfer_outbox_submission_accepted($1::text, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::text, $7::bigint, $8::text, $9::text, $10::text, $11::text, $12::text, $13::text, $14::text) AS outcome',
    parameters: 14,
  },
  markUnknown: {
    text: 'SELECT public.mark_piggyvest_transfer_outbox_submission_unknown($1::text, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::text, $7::bigint, $8::text, $9::text, $10::text, $11::text, $12::text, $13::text, $14::text) AS outcome',
    parameters: 14,
  },
  recoverUnknown: {
    text: 'SELECT public.recover_piggyvest_transfer_outbox_submission_unknown($1::text, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::text, $7::bigint, $8::text, $9::text, $10::text, $11::text, $12::text, $13::text, $14::text, $15::text, $16::text) AS outcome',
    parameters: 16,
  },
} as const;
