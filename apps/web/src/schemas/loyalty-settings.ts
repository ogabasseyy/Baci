import { z } from 'zod';

const INT32_MAX = 2 ** 31 - 1;

// Bonus/point/expiry settings land in PostgreSQL integer columns:
// fractional or out-of-range values would 500 on write instead of 400,
// so they are bounded here (mirrors loyalty-manual-points.ts).
const integerSetting = z.number().int().min(0).max(INT32_MAX).nullish();

// Tier entries were accepted as arbitrary records, so an over-long
// name was persisted and later failed inside calculate_loyalty_tier
// (its result and customer_loyalty.current_tier are varchar(50)) on
// every enrollment/award for that merchant. Bound the object to the
// shape the SQL readers and the settings form actually use.
// Legacy stored tiers can carry null multiplier/minPoints/perks
// (accepted as arbitrary JSON before this schema existed, and the
// storefront status path already tolerates those shapes). Normalize
// them on the way in — a merchant resubmitting stored settings to
// save an unrelated field must not be locked out until the JSON is
// hand-repaired. Null thresholds earn the SQL default (0), a null
// multiplier/perks list simply means unset.
const loyaltyTierSchema = z.object({
  name: z.string().trim().min(1).max(50),
  minPoints: z
    .number()
    .int()
    .min(0)
    .max(INT32_MAX)
    .nullish()
    .transform((value) => value ?? 0),
  multiplier: z
    .number()
    .finite()
    .min(0)
    .max(100)
    .nullish()
    .transform((value) => value ?? undefined),
  perks: z
    .array(z.string().max(100))
    .max(20)
    .nullish()
    .transform((value) => value ?? undefined),
});

// Earning/redemption rates land in numeric(10,2) / numeric(10,4)
// columns. A positive-but-tiny value rounds to zero on write (silently
// disabling awards or making the currency unit a divide-by-zero), and
// an oversized one makes the upsert fail with a 500. Require positive
// values the columns can store exactly.
function rateSetting(max: number, scale: number) {
  const quantum = 10 ** -scale;
  return z
    .number()
    .finite()
    .min(quantum)
    .max(max)
    .refine(
      (value) => Number(value.toFixed(scale)) === value,
      `must have at most ${scale} decimal places`
    )
    .nullish();
}

// POST /api/loyalty/settings payload. Every field is optional: omitted
// (or null) fields keep the route's defaults. The cap mirrors the
// numeric(5,2) column — at least 0.01 and at most two decimal places —
// because a positive value that rounds to 0.00 would be stored as zero
// and the redemption RPC treats a zero cap as program_unavailable.
export const loyaltySettingsPostSchema = z.object({
  enabled: z.boolean().nullish(),
  // loyalty_settings.program_name is varchar(100): an over-long name
  // would 500 the upsert instead of failing validation.
  program_name: z.string().max(100).nullish(),
  points_per_currency: rateSetting(99_999_999.99, 2),
  points_currency_unit: rateSetting(99_999_999.99, 2),
  signup_bonus_points: integerSetting,
  birthday_bonus_points: integerSetting,
  review_bonus_points: integerSetting,
  referral_bonus_points: integerSetting,
  points_to_currency_ratio: rateSetting(999_999.9999, 4),
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
  tiers: z.array(loyaltyTierSchema).max(50).nullish(),
  points_expiry_days: integerSetting,
});

export type LoyaltySettingsPostInput = z.infer<
  typeof loyaltySettingsPostSchema
>;
