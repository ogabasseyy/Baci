import { z } from 'zod';

// POST /api/loyalty/redemptions/consume payload: the presented code a
// merchant marks fulfilled for a manual-fulfillment reward.
export const loyaltyRedemptionConsumeSchema = z.object({
  code: z.string().trim().min(1, 'code is required'),
  // Per-attempt key: a lost-response retry reuses it so the RPC can
  // tell the same consume attempt from a later re-presentation.
  idempotency_key: z.string().trim().min(1).max(200).optional(),
});

export type LoyaltyRedemptionConsumeInput = z.infer<
  typeof loyaltyRedemptionConsumeSchema
>;
