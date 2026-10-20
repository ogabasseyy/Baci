import { z } from 'zod';

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
