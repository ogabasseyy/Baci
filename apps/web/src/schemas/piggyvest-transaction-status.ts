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

const walletTransferFields = {
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
};

function distinctWallets(data: {
  source_wallet: string;
  destination_wallet: string;
}) {
  return data.source_wallet !== data.destination_wallet;
}

const walletTransfer = z.object(walletTransferFields).refine(distinctWallets);

// The one provider transfer reader's record
// (lib/piggyvest/provider-transfer-reader.ts): the same strict fields, but
// it also reads a record whose fee PiggyVest leaves null, and it keeps
// currency and category as given so the reader can judge them itself (a
// non-NGN currency or a non-p2p category never binds). TSQ and GET
// /api/v1/transaction/:id answer this same record.
const providerTransfer = z
  .object({
    ...walletTransferFields,
    fee: z.int().nonnegative().nullable(),
    currency: text.optional(),
  })
  .refine(distinctWallets);

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

// wallet-transfer.outflow.success, as on PiggyVest's Webhooks > Events
// page: our reference is the envelope's pvb_third_party_reference, while
// eventData's third_party_reference and initiator_reference carry
// PiggyVest's own id. Read only to attribute the event to one of our
// transfers; no money moves on a webhook alone, so amounts and wallets are
// not parsed here.
const walletTransferEnvelope = z.object({
  eventType: z.literal('wallet-transfer.outflow.success'),
  eventCategory: z.literal('wallet_transfer'),
  pvb_third_party_reference: identifier.nullish(),
  eventData: z.object({
    category: z.literal('p2p').optional(),
    fee: z.int().nonnegative().nullish(),
    reference: identifier.optional(),
    initiator_reference: identifier.nullish(),
    internal_reference: identifier.optional(),
    third_party_reference: identifier.nullish(),
  }),
});

// What a reading binds to: the amount and the two registered wallets
// (house_wallets rows, or a live wallet readback, with the currency that
// source recorded), plus the registered Fee wallet when PiggyVest's API
// transfer-fee setting charges fees to it instead of the source wallet.
const registeredWallet = z.strictObject({
  walletId: identifier,
  currency: text,
  role: z.enum(['main', 'goal', 'collection', 'interest', 'fee']),
});
const providerTransferExpectation = z
  .strictObject({
    amountKobo: z.int().positive(),
    source: registeredWallet,
    destination: registeredWallet,
    feeWallet: z
      .strictObject({ walletId: identifier, currency: text })
      .optional(),
    businessId: identifier.optional(),
  })
  .refine(
    (data) =>
      data.source.walletId !== data.destination.walletId &&
      data.feeWallet?.walletId !== data.source.walletId &&
      data.feeWallet?.walletId !== data.destination.walletId
  );

export const piggyvestTransactionStatusSchemas = {
  walletTransfer,
  documented,
  data,
  response: z.object({ status: z.literal(true), data }),
  walletTransferResponse: z.object({
    status: z.literal(true),
    data: walletTransfer,
  }),
  providerTransfer,
  providerTransferResponse: z.object({
    status: z.literal(true),
    data: providerTransfer,
  }),
  walletTransferEnvelope,
  providerTransferExpectation,
};

export type PiggyvestTransactionStatus = z.infer<typeof data>;
export type ProviderTransferRecord = z.infer<typeof providerTransfer>;
export type ProviderTransferExpectation = z.input<
  typeof providerTransferExpectation
>;
