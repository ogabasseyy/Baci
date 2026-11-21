import { z } from 'zod';

/** Caller-owned suggestion only; never proof that an address was verified. */
export const oxygenResidentialContextSchema = z.object({
  address: z.record(z.string(), z.string().max(200)),
  source: z.enum(['saved', 'checkout']).default('checkout'),
});
