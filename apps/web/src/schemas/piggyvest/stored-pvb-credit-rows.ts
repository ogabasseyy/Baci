import z from 'zod';

const kobo = z.number().int().nonnegative();
const text = z.string().min(1);
/** NULL only on legacy rows written before pvb_reference became the key. */
const pvbReference = text.nullable();

/** Ledger rows as the duplicate-verify path reads them back. */
export const storedPvbCreditRowSchemas = {
  inflow: z.object({
    pvb_reference: pvbReference,
    provider_transaction_id: text,
    customer_id: text,
    wallet_id: text,
    amount_kobo: kobo,
    fee_kobo: kobo,
    reference: text,
    session_id: z.string().nullable(),
    event_data_id: text,
    credited_at: text,
  }),
  interest: z.object({
    pvb_reference: pvbReference,
    provider_payout_id: text,
    customer_id: text,
    wallet_id: text,
    amount_kobo: kobo,
    gross_kobo: kobo,
    withholding_tax_kobo: kobo,
    net_kobo: kobo,
    reference: text,
    batch_id: text,
    paid_at: text,
  }),
};
