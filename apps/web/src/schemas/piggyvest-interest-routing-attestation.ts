import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

export const piggyvestInterestRoutingAttestationSchema = z
  .object({
    attestationId: z.string().trim().min(1).max(128),
    attestedBy: z.string().trim().min(1).max(128),
    businessId: piggyvestProviderIdSchema,
    globalSplit: z.literal('9%/3%'),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();
