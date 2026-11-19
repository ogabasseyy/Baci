import { z } from 'zod';

/** Safe profile subset only. Identity numbers and provider verification are not inferred. */
export const oxygenCustomerPrefillSchema = z
  .object({
    first_name: z.string().trim().min(1).max(100).optional(),
    last_name: z.string().trim().min(1).max(100).optional(),
    email: z.email().max(100).optional(),
    date_of_birth: z.iso.date().optional(),
  })
  .strict();
export type OxygenCustomerPrefill = z.infer<typeof oxygenCustomerPrefillSchema>;
