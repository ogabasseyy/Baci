import z from 'zod';
import { isoDateTimeSchema } from './iso-datetime-schema';
import { koboAmountSchema } from './kobo-amount-schema';
import { nullableStringSchema } from './nullable-string-schema';

/**
 * Interest-payout success webhook event.
 *
 * Source: provider message shared 17 Sep 2026 (sample payload).
 * Status: schema-drafted from samples. NOT provider-certified.
 */

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

export type InterestPayoutSuccessEvent = z.infer<
  typeof interestPayoutSuccessEventSchema
>;
