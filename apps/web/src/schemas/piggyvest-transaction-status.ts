import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

/**
 * GET /api/v1/transaction/verify (transaction status query, TSQ).
 *
 * Evidence: docs/piggyvest-contract-evidence/2026-10-31.md (and .json), P2
 * (observed: transfer 202, then TSQ http_404 > pending > successful in 9
 * polls; no currency field; existing typed TSQ schema rejected the live
 * body). The separate 2026-10-31-2 run's P2 was inconclusive (QA wallets
 * unavailable) and proves none of this. For a wallet-to-wallet transfer the
 * terminal record names `reference` (the provider's id), `third_party_reference`
 * (our reference), `amount`, `fee`, `status` (`pending` then `successful`),
 * `customer_id`, `source_wallet` and `destination_wallet`, and carries no
 * currency field. An unknown reference and a just-submitted one both answer
 * HTTP 404 "Transaction Not Found", so a 404 never proves absence (see
 * lib/piggyvest/transfer-reference-lookup.ts).
 *
 * Fields a money decision reads stay strict: amount, status, both
 * references and both wallets. Descriptive extras (balances, names in
 * `meta`, narration) are stripped, as in the other PiggyVest read schemas,
 * so they never travel further than this parse.
 */
const identifier = piggyvestProviderIdSchema;
const text = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.isWellFormed());

const walletTransfer = z
  .object({
    id: identifier,
    reference: identifier,
    third_party_reference: identifier,
    internal_reference: identifier.optional(),
    status: z.enum(['pending', 'successful', 'success', 'failed']),
    amount: z.int().positive(),
    fee: z.int().nonnegative(),
    currency: z.literal('NGN').optional(),
    customer_id: identifier,
    // Not in the observed record; typed so a consumer can refuse a
    // mismatching business when PiggyVest does send it.
    business_id: identifier.optional(),
    source_wallet: identifier,
    destination_wallet: identifier,
    category: text.optional(),
    created_at: text.optional(),
    updated_at: text.optional(),
  })
  .refine((data) => data.source_wallet !== data.destination_wallet);

// Documented TSQ shape (bank transfers); kept as the typed client's
// original contract.
const documented = z.object({
  reference: z.string().min(1),
  status: z.enum(['success', 'pending', 'failed']),
  amount: z.int().nonnegative(),
  recipient: z.string(),
  bank: z.string(),
  created_at: z.iso.datetime({ offset: true }),
});

const data = z.union([walletTransfer, documented]);

export const piggyvestTransactionStatusSchemas = {
  walletTransfer,
  documented,
  data,
  response: z.object({ status: z.literal(true), data }),
  walletTransferResponse: z.object({
    status: z.literal(true),
    data: walletTransfer,
  }),
};

export type PiggyvestTransactionStatus = z.infer<typeof data>;
