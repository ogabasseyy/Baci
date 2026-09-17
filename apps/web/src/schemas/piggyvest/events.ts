import z from 'zod';

/**
 * Versioned PiggyVest staging webhook event schemas.
 *
 * Source: provider message shared 17 Sep 2026 (two sample payloads).
 * Status: schema-drafted from samples. NOT provider-certified.
 * Activation remains blocked pending retry/redelivery contract,
 * signed raw-byte samples, and credential provisioning.
 *
 * All money fields are integer kobo. Never mix naira and kobo.
 */

const koboAmountSchema = z.int().nonnegative();

const isoDateTimeSchema = z.iso.datetime({ offset: true });

const nullableStringSchema = z.string().nullable();

const bankTransferInflowSuccessDataSchema = z.object({
  id: z.string().min(1),
  customer_id: z.string().min(1),
  source_wallet_id: z.string(),
  destination_wallet_id: z.string().min(1),
  type: z.literal('inflow'),
  category: z.literal('bank_transfer_inflow'),
  amount: koboAmountSchema,
  currency: z.literal('NGN'),
  narration: z.string(),
  ip_address: z.string(),
  transaction_id: z.string().min(1),
  timestamp: isoDateTimeSchema,
  status: z.literal('success'),
  third_party_reference: z.string(),
  initiator_reference: z.string(),
  internal_reference: z.string(),
  attempts: z.int().nonnegative(),
  provider: z.string().min(1),
  destination_wallet_balance: koboAmountSchema,
  destination_wallet_ledger_balance: koboAmountSchema,
  destination_transaction_balance: koboAmountSchema,
  reference: z.string().min(1),
  recipient_bank_account_number: z.string().min(1),
  recipient_bank_account_name: z.string().min(1),
  sender_bank_account_number: z.string().min(1),
  sender_bank_name: z.string().min(1),
  sender_name: z.string().min(1),
  session_id: z.string().min(1),
  fee: koboAmountSchema,
});

export const bankTransferInflowSuccessEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal('bank-transfer.inflow.success'),
  eventCategory: z.literal('bank-transfer'),
  customer_id: z.string().min(1),
  eventData: bankTransferInflowSuccessDataSchema,
  pvb_reference: z.string().min(1),
  pvb_wallet: z.string().min(1),
  pvb_destination_wallet: nullableStringSchema,
  pvb_third_party_reference: nullableStringSchema,
  pvb_schedule_payment_id: nullableStringSchema,
  pvb_destination_account_creation_reference: nullableStringSchema,
  pvb_meta: nullableStringSchema,
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
  eventCategory: z.literal('interest-payout'),
  customer_id: z.string().min(1),
  eventData: interestPayoutSuccessDataSchema,
  pvb_reference: z.string().min(1),
  pvb_wallet: z.string().min(1),
  pvb_accrued_interest_wallet: z.string().min(1),
  pvb_destination_wallet: nullableStringSchema,
  pvb_third_party_reference: nullableStringSchema,
});

export const piggyvestWebhookEventSchema = z.discriminatedUnion('eventType', [
  bankTransferInflowSuccessEventSchema,
  interestPayoutSuccessEventSchema,
]);

export type BankTransferInflowSuccessEvent = z.infer<
  typeof bankTransferInflowSuccessEventSchema
>;
export type InterestPayoutSuccessEvent = z.infer<
  typeof interestPayoutSuccessEventSchema
>;
export type PiggyvestWebhookEvent = z.infer<typeof piggyvestWebhookEventSchema>;
