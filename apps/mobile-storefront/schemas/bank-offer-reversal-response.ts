import { z } from 'zod';

// Accept additive metadata. Reject a contradictory settlement outcome.
export const bankOfferReversalResponseSchema = z.object({
  orderId: z.string(),
  status: z.literal('reversed'),
  success: z.literal(false),
  finalizationOutcome: z.never().optional(),
  reference: z.string(),
});
