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
