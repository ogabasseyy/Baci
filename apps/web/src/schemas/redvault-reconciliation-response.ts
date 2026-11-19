import { z } from 'zod';
import { redvaultRecoveredOrderResponseSchema } from './redvault-recovered-order-response';

export const redvaultReconciliationResponseSchema = z.discriminatedUnion(
  'kind',
  [
    z.object({
      kind: z.literal('retired'),
      cartId: z.string(),
      checkoutSessionId: z.string(),
      checkoutGeneration: z.number(),
    }),
    redvaultRecoveredOrderResponseSchema.extend({
      kind: z.literal('submitted'),
    }),
  ]
);
