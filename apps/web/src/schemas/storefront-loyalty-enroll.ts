import { z } from 'zod';

export const storefrontLoyaltyEnrollSchema = z.object({
  merchant_id: z.uuid(),
  customer_id: z.uuid(),
  // customer_loyalty.referral_code is varchar(20); the RPC matches case-insensitively.
  referral_code: z.string().trim().min(1).max(20).optional(),
});

export type StorefrontLoyaltyEnrollInput = z.infer<
  typeof storefrontLoyaltyEnrollSchema
>;

export const storefrontLoyaltyEnrollResultSchema = z.object({
  success: z.literal(true),
  points_balance: z.number(),
  lifetime_points: z.number().optional(),
  current_tier: z.string(),
  referral_code: z.string(),
  referral_bonus_applied: z.boolean().optional(),
});

export type StorefrontLoyaltyEnrollResult = z.infer<
  typeof storefrontLoyaltyEnrollResultSchema
>;
