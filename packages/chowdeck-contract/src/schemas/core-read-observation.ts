import { z } from 'zod';
import isoCurrencies from '../../config/iso-4217-list-one.json';

const currentCurrencyCodes = new Set(isoCurrencies.codes);

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const wholeSecondTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/)
  .refine((value) => new Date(value).toISOString() === value);

export const accountIdentitySchema = z
  .object({
    domain: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/),
    vendorId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .refine((code) => currentCurrencyCodes.has(code)),
  })
  .strict();

export const coreObservationSchema = z
  .object({
    contractVersion: z.literal(1),
    capturedAt: wholeSecondTimestampSchema,
    publicContractDigest: digestSchema,
    manifestDigest: digestSchema,
    status: z.literal('not_observed'),
    blockerCode: z.literal('provider_response_schema_unproven'),
    capabilities: z
      .object({
        accountRead: z.literal('unproven'),
        categoryRead: z.literal('unproven'),
        menuRead: z.literal('unproven'),
        itemRead: z.literal('unproven'),
      })
      .strict(),
    latencyBucket: z.literal('unavailable'),
    byteBucket: z.literal('unavailable'),
    rateLimitBucket: z.literal('unavailable'),
    limitBucket: z.literal('unavailable'),
  })
  .strict();

export type ChowdeckAccountIdentityV1 = z.infer<typeof accountIdentitySchema>;
export type ChowdeckCoreReadObservationV1 = z.infer<
  typeof coreObservationSchema
>;
