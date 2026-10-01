import { z } from 'zod';

// Result payload of the `complete_order_gateway_payment` RPC
// (supabase/migrations/20260714123000_complete_order_gateway_payment_atomic.sql).
// Parsed at the RPC boundary so route/cron callers never touch raw jsonb.
const optionalCompletionFields = {
  actor: z.string().nullish(),
  already_completed: z.boolean().optional(),
  cancelled_at: z.string().nullish(),
  merchant_invoice_partial_recorded: z.boolean().optional(),
  order_already_paid: z.boolean().optional(),
  order_cancelled: z.boolean().optional(),
  order_number: z.string().nullish(),
  order_skipped_status: z.string().nullish(),
  order_updated: z.boolean().optional(),
  payment_status: z.string().nullish(),
  previous_payment_status: z.string().nullish(),
  previous_shipping_status: z.string().nullish(),
  shipping_status: z.string().nullish(),
};

const completionErrorSchema = z.object({
  ...optionalCompletionFields,
  error_code: z.enum([
    'INVALID_ARGUMENTS',
    'TRANSACTION_NOT_FOUND',
    'ORDER_TRANSACTION_MISMATCH',
    'TRANSACTION_IN_UNEXPECTED_STATE',
    'ORDER_NOT_FOUND',
    'MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED',
  ]),
  transaction_status: z.string().nullish(),
});

const completionSuccessSchema = z.object({
  actor: z.string().nullable(),
  already_completed: z.boolean(),
  cancelled_at: z.string().nullable(),
  merchant_invoice_partial_recorded: z.boolean().optional(),
  order_already_paid: z.boolean(),
  order_cancelled: z.boolean(),
  order_number: z.string().nullable(),
  order_skipped_status: z.string().nullable(),
  order_updated: z.boolean(),
  payment_status: z.string().nullable(),
  previous_payment_status: z.string().nullable(),
  previous_shipping_status: z.string().nullable(),
  shipping_status: z.string().nullable(),
  error_code: z.undefined().optional(),
  transaction_status: z.string().nullish(),
});

export const orderGatewayPaymentCompletionSchema = z.union([
  completionErrorSchema,
  completionSuccessSchema,
]);

export type OrderGatewayPaymentCompletion = z.infer<
  typeof orderGatewayPaymentCompletionSchema
>;
