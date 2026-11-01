import { z } from 'zod';

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const timestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/)
  .refine((value) => new Date(value).toISOString() === value);
const disabledUnprovenSchema = z
  .object({
    enabled: z.literal(false),
    code: z.literal('provider_contract_unproven'),
  })
  .strict();

export const providerContractSchema = z
  .object({
    contractVersion: z.literal(1),
    capturedAt: timestampSchema,
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
