import { z } from 'zod';

export const redvaultRecoveryCustomerSchema = z.object({
  customer_email: z.string(),
  customer_name: z.string(),
  customer_phone: z.string(),
});
