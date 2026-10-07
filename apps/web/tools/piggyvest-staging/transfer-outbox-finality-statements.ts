export const PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS = {
  readExpected: {
    text: 'SELECT customer_id, reference, amount_kobo, currency, source_wallet_id, destination_ref, direction, provider_customer_id, business_id, integration_id, status FROM public.read_piggyvest_transfer_outbox_finality_scoped($1::text, $2::text, $3::text, $4::text, $5::text)',
    parameters: 5,
  },
  compareAndSet: {
    text: 'SELECT public.apply_piggyvest_transfer_outbox_finality($1::text, $2::text, $3::bigint, $4::text, $5::text, $6::text, $7::text, $8::text, $9::text, $10::text, $11::text, $12::text) AS outcome',
    parameters: 12,
  },
} as const;
