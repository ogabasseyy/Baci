import { z } from 'zod';

export const oxygenFollowUpOrderSchema = z
  .object({
    id: z.uuid(),
    order_number: z.string().nullable(),
    customer_id: z.uuid().nullable(),
    customer_name: z.string().nullable(),
    customer_email: z.string().nullable(),
    customer_phone: z.string().nullable(),
    total: z.union([z.number(), z.string()]).nullable(),
    payment_status: z.string().nullable(),
    payment_method: z.string().nullable(),
    created_at: z.iso.datetime({ offset: true }),
    cancelled_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
