import { z } from 'zod';

/** Projection returned by the owned-order access lookup; reject unexpected storage shapes. */
export const oxygenOrderAccessRowSchema = z.object({
  id: z.uuid(),
  merchant_id: z.uuid(),
  customer_id: z.uuid().nullable(),
});
export const oxygenCustomerAccessRowSchema = z.object({ id: z.uuid() });
