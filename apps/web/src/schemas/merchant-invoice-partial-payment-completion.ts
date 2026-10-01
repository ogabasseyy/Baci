import { z } from 'zod';

const partialRecordedSchema = z.object({
  outcome: z.literal('partial_recorded'),
  already_completed: z.boolean(),
  amount_applied: z.number().finite().positive(),
  amount_paid: z.number().finite().nonnegative(),
  balance_due: z.number().finite().nonnegative(),
  order_number: z.string().nullable(),
  payment_status: z.string(),
  shipping_status: z.string(),
});

const standardCompletionSchema = z.object({
  outcome: z.literal('standard_completion'),
  reason: z.enum([
    'amount_now_completes_order',
    'exact_completion_replay',
    'order_terminal',
  ]),
});

const reviewRequiredSchema = z.object({
  outcome: z.literal('review_required'),
  error_code: z.string().trim().min(1),
  remaining_balance: z.number().finite().nonnegative().optional(),
});

export const merchantInvoicePartialPaymentCompletionSchema =
  z.discriminatedUnion('outcome', [
    partialRecordedSchema,
    standardCompletionSchema,
    reviewRequiredSchema,
  ]);

export type MerchantInvoicePartialPaymentCompletion = z.infer<
  typeof merchantInvoicePartialPaymentCompletionSchema
>;
