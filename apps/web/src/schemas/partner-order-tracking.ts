import { z } from 'zod';

const paymentStatus = z.enum([
  'unpaid',
  'pending',
  'partially_paid',
  'paid',
  'partially_refunded',
  'refunded',
  'cancelled',
  'chargeback',
  'unknown',
]);
const shippingStatus = z.enum([
  'pending',
  'processing',
  'shipped',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'returned',
  'failed',
  'unknown',
]);
const normalizedStatus = z
  .string()
  .transform((value) => (value === 'canceled' ? 'cancelled' : value));

export const orderTrackingSchema = z.object({
  order_id: z.uuid(),
  partner_order_id: z.string(),
  payment_status: normalizedStatus.transform(
    (value) => paymentStatus.safeParse(value).data ?? 'unknown'
  ),
  shipping_status: normalizedStatus.transform(
    (value) =>
      shippingStatus.safeParse(value === 'completed' ? 'delivered' : value)
        .data ?? 'unknown'
  ),
  tracking: z
    .object({
      provider: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
      tracking_number: z.string().min(1).max(128),
    })
    .nullable(),
});
