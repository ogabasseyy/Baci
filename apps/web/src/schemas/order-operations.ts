import { z } from 'zod';
import { sanitizeEmail, sanitizeText } from '@/lib/sanitize-core';

export const reuseCheckoutOrderSchema = z.object({
  order_id: z.uuid(),
  merchant_id: z.uuid(),
  tracking_token: z.preprocess(
    (value) => (typeof value === 'string' ? sanitizeText(value, 128) : value),
    z.string().min(1)
  ),
  customer_email: z.preprocess(
    (value) => (typeof value === 'string' ? sanitizeEmail(value) : value),
    z.email()
  ),
  payment_method: z.preprocess(
    (value) => (typeof value === 'string' ? sanitizeText(value) : value),
    z.string().min(1)
  ),
  // B3 (plan §5 B3): accept null so pickup/airport reuse flows can
  // signal "no third-party shipping provider" cleanly.
  selected_quote_id: z.uuid().nullable().optional(),
  // Merchant-configured shipping rate (merchant_shipping_rates.id). Forwarded
  // when reopening a merchant-rate pending order whose original post-create
  // provider stamp failed, so the reuse route can re-stamp the fulfillment
  // provider + rate name (R14-3 — the reuse-path analogue of the orders POST
  // R9-5 re-stamp). This is the BARE rate uuid; the synthetic `mrate_`-prefixed
  // selected_quote_id stays nulled for merchant rates. Nullable like
  // selected_quote_id so clients can send an explicit null.
  shipping_rate_id: z.uuid().nullable().optional(),
  shipping_provider: z
    .string()
    .nullable()
    .optional()
    .transform((val) => (val ? sanitizeText(val) : val)),
});

export type ReuseCheckoutOrderInput = z.infer<typeof reuseCheckoutOrderSchema>;

export const orderIdParamsSchema = z.object({
  id: z.uuid(),
});

export const orderUpdateSchema = z
  .strictObject({
    // Transitional compatibility for deployed mobile clients. Authorization
    // remains derived from the authenticated user; this value is ignored.
    merchant_id: z.uuid(),
    payment_status: z.enum([
      'paid',
      'unpaid',
      'pending',
      'failed',
      'refunded',
      'partially_paid',
      'bnpl_approved',
      'bnpl_pending',
    ]),
    shipping_status: z.enum([
      'pending',
      'processing',
      'shipped',
      'out_for_delivery',
      'delivered',
      'completed',
      'cancelled',
      'canceled',
      'returned',
      'failed',
    ]),
    notes: z.string().nullable(),
    shipping_address: z.record(z.string(), z.unknown()).nullable(),
  })
  .partial();

export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;

export const merchantOrderCancellationSchema = z.strictObject({
  cancelled_by: z.literal('merchant').optional(),
  confirm_cancellation: z.literal(true),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) =>
      value ? sanitizeText(value, 500).trim() || undefined : undefined
    ),
});

const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  payment_method: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((val) => sanitizeText(val ?? 'manual', 50)),
  reference: z
    .string()
    .optional()
    .transform((val) => (val ? sanitizeText(val, 100) : val)),
  notes: z
    .string()
    .optional()
    .transform((val) => (val ? sanitizeText(val, 500) : val)),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
