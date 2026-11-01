import { z } from 'zod';
import { wholeSecondTimestampSchema } from './whole-second-timestamp';

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

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

export type ChowdeckCoreReadObservationV1 = z.infer<
  typeof coreObservationSchema
>;
