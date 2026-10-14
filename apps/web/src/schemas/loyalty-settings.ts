import { z } from 'zod';

const INT32_MAX = 2 ** 31 - 1;

// Bonus/point/expiry settings land in PostgreSQL integer columns:
// fractional or out-of-range values would 500 on write instead of 400,
// so they are bounded here (mirrors loyalty-manual-points.ts).
const integerSetting = z.number().int().min(0).max(INT32_MAX).nullish();

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
  signup_bonus_points: integerSetting,
  birthday_bonus_points: integerSetting,
  review_bonus_points: integerSetting,
  referral_bonus_points: integerSetting,
  points_to_currency_ratio: z.number().finite().nullish(),
  minimum_redemption_points: integerSetting,
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
  points_expiry_days: integerSetting,
});

export type LoyaltySettingsPostInput = z.infer<
  typeof loyaltySettingsPostSchema
>;
