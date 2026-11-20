import { z } from 'zod';

export const orderTrackingSchema = z.object({
  order_id: z.uuid(),
  partner_order_id: z.string(),
  payment_status: z.string(),
  shipping_status: z.string(),
  tracking: z
    .object({
      provider: z.string(),
      tracking_number: z.string(),
    })
    .nullable(),
});
