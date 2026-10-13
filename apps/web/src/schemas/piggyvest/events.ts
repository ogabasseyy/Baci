import z from 'zod';

/**
 * Versioned PiggyVest staging webhook event schemas.
 *
 * Sources: provider message shared 17 Sep 2026 (two sample payloads) and
 * the official PiggyVest Business docs (webhook events + payload structure
 * pages) for create-wallet.success. Status: schema-drafted, NOT
 * provider-certified. Activation remains blocked pending retry/redelivery
 * contract, signed raw-byte samples, and credential provisioning.
 *
 * All money fields are integer kobo. Never mix naira and kobo.
 */

const koboAmountSchema = z.int().nonnegative();

const isoDateTimeSchema = z.iso.datetime({ offset: true });

const nullableStringSchema = z.string().nullable();

const bankTransferInflowSuccessDataSchema = z.object({
  id: z.string().min(1),
  customer_id: z.string().min(1),
  source_wallet_id: z.string().optional(),
  destination_wallet_id: z.string().min(1),
  // Genuine staging event 18 Sep 2026 carried type "inter" (samples said
  // "inflow") and status "COMPLETED" (samples said "success"). Accept the
  // observed values; anything else still quarantines.
  type: z.enum(['inflow', 'inter']),
  category: z.literal('bank_transfer_inflow'),
  amount: koboAmountSchema,
  currency: z.literal('NGN'),
  narration: z.string(),
  ip_address: z.string(),
  transaction_id: z.string().min(1),
  timestamp: isoDateTimeSchema,
  status: z.enum(['success', 'COMPLETED']),
  third_party_reference: z.string(),
  initiator_reference: z.string(),
  internal_reference: z.string(),
  attempts: z.int().nonnegative().optional(),
  provider: z.string().min(1),
  destination_wallet_balance: koboAmountSchema,
  destination_wallet_ledger_balance: koboAmountSchema,
  destination_transaction_balance: koboAmountSchema,
  reference: z.string().min(1),
  recipient_bank_account_number: z.string().min(1).optional(),
  recipient_bank_account_name: z.string().min(1).optional(),
  sender_bank_account_number: z.string().nullable().optional(),
  sender_bank_name: z.string().nullable().optional(),
  sender_name: z.string().nullable().optional(),
  session_id: z.string().min(1).nullable().optional(),
  fee: koboAmountSchema,
});

export const bankTransferInflowSuccessEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal('bank-transfer.inflow.success'),
  // Genuine staging event 18 Sep 2026 carried "inflow_transaction"
  // (samples said "bank-transfer"). Accept the observed value.
  eventCategory: z.enum(['bank-transfer', 'inflow_transaction']),
  customer_id: z.string().min(1),
  eventData: bankTransferInflowSuccessDataSchema,
  pvb_reference: z.string().min(1),
  pvb_wallet: z.string().min(1),
  // Observed genuine delivery omits these keys entirely when unset.
  pvb_destination_wallet: nullableStringSchema.optional(),
  pvb_third_party_reference: nullableStringSchema.optional(),
  pvb_schedule_payment_id: nullableStringSchema.optional(),
  pvb_destination_account_creation_reference: nullableStringSchema.optional(),
  pvb_meta: nullableStringSchema.optional(),
});

const interestBreakdownSchema = z.object({
  gross_interest_payout: koboAmountSchema,
  withholding_tax: koboAmountSchema,
  net_interest_payout: koboAmountSchema,
});

const interestPayoutSuccessDataSchema = z.object({
  id: z.string().min(1),
  amount: koboAmountSchema,
  destination_wallet: z.string().min(1),
  destination_wallet_balance: koboAmountSchema,
  destination_wallet_ledger_balance: koboAmountSchema,
  reference: z.string().min(1),
  timestamp: isoDateTimeSchema,
  batch_id: z.string().min(1),
  break_down: interestBreakdownSchema,
});

export const interestPayoutSuccessEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal('interest-payout.success'),
  eventCategory: z.enum(['interest-payout', 'interest_payout']),
  customer_id: z.string().min(1),
  eventData: interestPayoutSuccessDataSchema,
  pvb_reference: z.string().min(1),
  pvb_wallet: z.string().min(1),
  pvb_accrued_interest_wallet: z.string().min(1),
  pvb_destination_wallet: nullableStringSchema,
  pvb_third_party_reference: nullableStringSchema,
});

export const createWalletSuccessEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal('create-wallet.success'),
  eventCategory: z.literal('create_wallet'),
  customer_id: z.string().min(1),
  // Official docs mark the details object as event-specific without a
  // published shape; accept (never trust) whatever arrives.
  eventData: z.looseObject({}),
  pvb_wallet: z.string().min(1),
});

export const reserveVirtualAccountSuccessEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal('reserve_virtual_account.success'),
  // Category value unpublished; eventType alone routes this event.
  eventCategory: z.string().min(1),
  customer_id: z.string().min(1),
  eventData: z.looseObject({}),
});

export const bankTransferOutflowSuccessEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal('bank-transfer.outflow.success'),
  eventCategory: z.string().min(1),
  customer_id: z.string().min(1),
  eventData: z.looseObject({}),
});

export const bankTransferOutflowFailedEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal('bank-transfer.outflow.failed'),
  eventCategory: z.string().min(1),
  customer_id: z.string().min(1),
  eventData: z.looseObject({}),
});

export const walletTransferOutflowSuccessEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal('wallet-transfer.outflow.success'),
  eventCategory: z.string().min(1),
  customer_id: z.string().min(1),
  eventData: z.looseObject({}),
});

export const restrictionCreatedSuccessEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal('restriction-created.success'),
  // Category and details unpublished; eventType routes this event.
  // A restricted wallet must block outbound transfers until lifted.
  // Wallet attribution comes from pvb_wallet or eventData.wallet_id when
  // the provider includes either; without attribution the processor acks
  // without flipping any row (fail closed).
  eventCategory: z.string().min(1),
  customer_id: z.string().min(1),
  eventData: z.looseObject({}),
  pvb_wallet: z.string().min(1).optional(),
});

export const restrictionLiftedSuccessEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal('restriction-lifted.success'),
  eventCategory: z.string().min(1),
  customer_id: z.string().min(1),
  eventData: z.looseObject({}),
  pvb_wallet: z.string().min(1).optional(),
});

export const piggyvestWebhookEventSchema = z.discriminatedUnion('eventType', [
  bankTransferInflowSuccessEventSchema,
  interestPayoutSuccessEventSchema,
  createWalletSuccessEventSchema,
  reserveVirtualAccountSuccessEventSchema,
  bankTransferOutflowSuccessEventSchema,
  bankTransferOutflowFailedEventSchema,
  walletTransferOutflowSuccessEventSchema,
  restrictionCreatedSuccessEventSchema,
  restrictionLiftedSuccessEventSchema,
]);

export type BankTransferInflowSuccessEvent = z.infer<
  typeof bankTransferInflowSuccessEventSchema
>;
export type InterestPayoutSuccessEvent = z.infer<
  typeof interestPayoutSuccessEventSchema
>;
export type CreateWalletSuccessEvent = z.infer<
  typeof createWalletSuccessEventSchema
>;
export type ReserveVirtualAccountSuccessEvent = z.infer<
  typeof reserveVirtualAccountSuccessEventSchema
>;
export type BankTransferOutflowSuccessEvent = z.infer<
  typeof bankTransferOutflowSuccessEventSchema
>;
export type BankTransferOutflowFailedEvent = z.infer<
  typeof bankTransferOutflowFailedEventSchema
>;
export type WalletTransferOutflowSuccessEvent = z.infer<
  typeof walletTransferOutflowSuccessEventSchema
>;
export type RestrictionCreatedSuccessEvent = z.infer<
  typeof restrictionCreatedSuccessEventSchema
>;
export type RestrictionLiftedSuccessEvent = z.infer<
  typeof restrictionLiftedSuccessEventSchema
>;
export type PiggyvestWebhookEvent = z.infer<typeof piggyvestWebhookEventSchema>;
