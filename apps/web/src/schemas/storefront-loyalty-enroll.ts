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
