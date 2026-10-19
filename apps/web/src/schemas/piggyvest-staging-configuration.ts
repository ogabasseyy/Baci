import { z } from 'zod';

export const PIGGYVEST_STAGING_API_ORIGIN =
  'https://staging.piggyvest.business';

export const piggyvestStagingConfigurationSchema = z
  .object({
    apiBaseUrl: z
      .literal(PIGGYVEST_STAGING_API_ORIGIN)
      .default(PIGGYVEST_STAGING_API_ORIGIN),
    apiSecret: z.string().trim().min(1),
    expectedBusinessId: z.string().trim().min(1),
    expectedCurrency: z.string().trim().min(1).default('NGN'),
    timeoutMs: z.number().int().positive().max(10_000).default(5_000),
    maxResponseBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024)
      .default(64 * 1024),
  })
  .strict();

export type PiggyvestStagingConfiguration = z.infer<
  typeof piggyvestStagingConfigurationSchema
>;
