import { z } from 'zod';

export const storefrontLoyaltyRedeemSchema = z.object({
  merchant_id: z.uuid(),
  customer_id: z.uuid(),
  reward_id: z.uuid(),
});

export type StorefrontLoyaltyRedeemInput = z.infer<
  typeof storefrontLoyaltyRedeemSchema
>;

export const storefrontLoyaltyRedeemResultSchema = z.object({
  success: z.literal(true),
  redemption_code: z.string(),
  reward_name: z.string(),
  reward_type: z.string(),
  reward_value: z.number().nullable(),
  points_spent: z.number(),
  new_balance: z.number(),
  expires_at: z.string(),
});

export type StorefrontLoyaltyRedeemResult = z.infer<
  typeof storefrontLoyaltyRedeemResultSchema
>;
