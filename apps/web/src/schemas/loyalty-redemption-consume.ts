import { z } from 'zod';

// POST /api/loyalty/redemptions/consume payload: the presented code a
// merchant marks fulfilled for a manual-fulfillment reward.
export const loyaltyRedemptionConsumeSchema = z.object({
  code: z.string().trim().min(1, 'code is required'),
  // Per-attempt key (required): a lost-response retry reuses it so
  // the RPC can tell the same consume attempt from a later
  // re-presentation. A keyless consume stamps NULL in the RPC, which
  // makes its retry indistinguishable from a re-presentation.
  idempotency_key: z.string().trim().min(1).max(200),
});

export type LoyaltyRedemptionConsumeInput = z.infer<
  typeof loyaltyRedemptionConsumeSchema
>;
