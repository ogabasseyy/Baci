import { z } from 'zod';
import { wholeSecondTimestampSchema } from './whole-second-timestamp';

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const disabledUnprovenSchema = z
  .object({
    enabled: z.literal(false),
    code: z.literal('provider_contract_unproven'),
  })
  .strict();

export const providerContractSchema = z
  .object({
    contractVersion: z.literal(1),
    capturedAt: wholeSecondTimestampSchema,
    publicContractDigest: digestSchema,
    observationManifestDigest: digestSchema,
    capabilities: z
      .object({
        accountRead: z
          .object({
            enabled: z.literal(false),
            code: z.literal('provider_response_schema_unproven'),
          })
          .strict(),
        catalogRead: z
          .object({
            enabled: z.literal(false),
            code: z.literal('provider_pagination_unproven'),
          })
          .strict(),
        catalogWrite: disabledUnprovenSchema,
        mediaWrite: disabledUnprovenSchema,
        orderRead: disabledUnprovenSchema,
        commandWrite: disabledUnprovenSchema,
      })
      .strict(),
  })
  .strict();

export type ChowdeckProviderContractV1 = z.infer<typeof providerContractSchema>;
