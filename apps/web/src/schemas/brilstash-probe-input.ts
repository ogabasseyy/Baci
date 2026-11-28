import { z } from 'zod';
import { BRILSTASH_PARTNER_PRICE_FLOOR } from '../config/brilstash-feed';

export const brilStashProbeInputSchema = z.strictObject({
  installationId: z.uuid(),
  expectedGenerationId: z.uuid(),
  expectedPayloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  minPrice: z.literal([0, BRILSTASH_PARTNER_PRICE_FLOOR]).optional(),
});
