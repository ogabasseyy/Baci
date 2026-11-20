import { z } from 'zod';
import { BRILSTASH_PILOT_LISTING_LIMIT } from '../config/brilstash-feed';
import { brilstashProductSchema } from './brilstash-feed';

export const brilStashPageResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ok'),
    products: z
      .array(brilstashProductSchema)
      .max(BRILSTASH_PILOT_LISTING_LIMIT),
    totalCount: z.int().min(0).max(BRILSTASH_PILOT_LISTING_LIMIT),
    totalPages: z.int().min(0).max(BRILSTASH_PILOT_LISTING_LIMIT),
    generationId: z.uuid(),
    credentialId: z.uuid(),
    payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({ status: z.literal('unauthorized') }),
  z.strictObject({ status: z.literal('ingress_unavailable') }),
  z.strictObject({ status: z.literal('invalid_query') }),
  z.strictObject({ status: z.literal('unavailable') }),
]);
