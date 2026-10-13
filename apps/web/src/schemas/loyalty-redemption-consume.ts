import { z } from 'zod';

// POST /api/loyalty/redemptions/consume payload: the presented code a
// merchant marks fulfilled for a manual-fulfillment reward.
export const loyaltyRedemptionConsumeSchema = z.object({
  code: z.string().trim().min(1, 'code is required'),
});

export type LoyaltyRedemptionConsumeInput = z.infer<
  typeof loyaltyRedemptionConsumeSchema
>;
