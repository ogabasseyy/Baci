import { z } from 'zod';

export const storefrontLoyaltyStatusQuerySchema = z.object({
  merchant_id: z.uuid(),
  customer_id: z.uuid(),
});

export type StorefrontLoyaltyStatusQuery = z.infer<
  typeof storefrontLoyaltyStatusQuerySchema
>;

const loyaltyTierSchema = z.object({
  name: z.string(),
  minPoints: z.number(),
  multiplier: z.number().nullable().optional(),
  perks: z.array(z.string()).nullable().optional(),
});

const loyaltyStatusRewardSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  points_cost: z.number(),
  reward_type: z.string(),
  reward_value: z.number().nullable(),
});

const loyaltyStatusTransactionSchema = z.object({
  id: z.string(),
  points: z.number(),
  type: z.string(),
  description: z.string().nullable(),
  created_at: z.string(),
});

export const storefrontLoyaltyStatusResultSchema = z.object({
  success: z.literal(true),
  enrolled: z.boolean(),
  points_balance: z.number(),
  lifetime_points: z.number(),
  current_tier: z.string(),
  referral_code: z.string().nullable(),
  tiers: z.array(loyaltyTierSchema),
  signup_bonus_points: z.number(),
  referral_bonus_points: z.number(),
  points_per_currency: z.number().nullable(),
  points_currency_unit: z.number().nullable(),
  rewards: z.array(loyaltyStatusRewardSchema),
  transactions: z.array(loyaltyStatusTransactionSchema),
});

export type StorefrontLoyaltyStatusResult = z.infer<
  typeof storefrontLoyaltyStatusResultSchema
>;
