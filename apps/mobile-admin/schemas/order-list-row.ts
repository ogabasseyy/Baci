import { z } from 'zod';

const SHIPPING_STATUSES = [
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
] as const;
const PAYMENT_STATUSES = [
  'paid',
  'unpaid',
  'pending',
  'failed',
  'refunded',
  'partially_paid',
  'bnpl_approved',
  'bnpl_pending',
  'cancelled',
  'expired',
] as const;

export const orderListRowSchema = z
  .object({
    order_items: z.array(z.object({ id: z.string() }).passthrough()).nullish(),
    payment_status: z.enum(PAYMENT_STATUSES),
    shipping_status: z.preprocess(
      (status) => (status === 'fulfilled' ? 'delivered' : status),
      z.enum(SHIPPING_STATUSES)
    ),
  })
  .passthrough();

export type OrderListRow = z.infer<typeof orderListRowSchema>;
