import { z } from 'zod';

/** Success body of PATCH /api/orders/[id]; only the order id is relied on. */
export const orderShippingAddressSaveResponseSchema = z.object({
  order: z.object({ id: z.string().min(1) }),
});

/** Safe error shape returned by PATCH /api/orders/[id]. */
export const orderShippingAddressSaveErrorSchema = z.object({
  code: z.string().optional(),
  error: z.string().optional(),
});
