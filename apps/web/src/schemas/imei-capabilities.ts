import { z } from 'zod';

/** Public configuration discovery; identifiers and tenant data are not inputs. */
export const imeiCapabilitiesQuerySchema = z.strictObject({
  device: z.enum(['smartphone', 'tablet', 'laptop', 'watch']).optional(),
  clientCapabilities: z
    .array(z.string().trim().min(1).max(64))
    .max(10)
    .default([]),
});
