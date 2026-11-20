import { z } from 'zod';

export const orderSchema = z.strictObject({
  quote_id: z.uuid(),
  partner_order_id: z.string().trim().min(1).max(128),
  recipient: z.strictObject({
    name: z.string().trim().min(1).max(160),
    phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
    email: z.email().max(254),
  }),
  payment: z.strictObject({
    source: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
    reference: z.string().trim().min(1).max(200),
    amount_minor: z.number().int().positive(),
    currency: z.literal('NGN'),
  }),
});
