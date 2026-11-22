import { z } from 'zod';

export const oxygenMobileCapabilitiesQuerySchema = z
  .object({
    merchantSlug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();

export const oxygenMobileReadinessRowSchema = z
  .object({
    merchant_id: z.uuid(),
    merchant_slug: oxygenMobileCapabilitiesQuerySchema.shape.merchantSlug,
    environment: z.enum(['staging', 'production']).nullable(),
    binding_ready: z.boolean(),
  })
  .strict();
