import { z } from 'zod';

export const paystackTerminalCustomerSchema = z.object({
  customer: z.object({
    email: z.string().trim().pipe(z.email()),
  }),
});
