import { z } from 'zod';

// POST /api/loyalty/settings payload. Every field is optional: omitted
// (or null) fields keep the route's defaults. The cap mirrors the
// numeric(5,2) column — at least 0.01 and at most two decimal places —
// because a positive value that rounds to 0.00 would be stored as zero
// and the redemption RPC treats a zero cap as program_unavailable.
export const loyaltySettingsPostSchema = z.object({
  enabled: z.boolean().nullish(),
  program_name: z.string().nullish(),
  points_per_currency: z.number().finite().nullish(),
  points_currency_unit: z.number().finite().nullish(),
  signup_bonus_points: z.number().finite().nullish(),
  birthday_bonus_points: z.number().finite().nullish(),
  review_bonus_points: z.number().finite().nullish(),
  referral_bonus_points: z.number().finite().nullish(),
  points_to_currency_ratio: z.number().finite().nullish(),
  minimum_redemption_points: z.number().finite().nullish(),
  maximum_redemption_percentage: z
    .number()
    .finite()
    .min(0.01)
    .max(100)
    .refine(
      (value) => Number(value.toFixed(2)) === value,
      'must have at most two decimal places'
    )
    .nullish(),
  tiers: z.array(z.record(z.string(), z.unknown())).nullish(),
  points_expiry_days: z.number().finite().nullish(),
});

export type LoyaltySettingsPostInput = z.infer<
  typeof loyaltySettingsPostSchema
>;
