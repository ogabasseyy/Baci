import { z } from 'zod';

const MAX_REASON_LENGTH = 500;

// Balances, lifetimes, and transaction points are PostgreSQL integer
// columns: out-of-range adjustments would 500 on write instead of 400.
const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

// Manual awards are always plain adjustments: points_transactions.type
// has no CHECK constraint, so any other label (earn, redemption, bonus,
// referral, expiry) would forge ledger rows that corrupt expiry and
// redemption accounting.
const MANUAL_POINTS_TYPES = ['adjust'] as const;

export const loyaltyManualPointsSchema = z.object({
  customerId: z.uuid(),
  // points_transactions.points is an integer column: fractional or
  // out-of-range values would 500 on write, and zero-point adjustments
  // are no-ops. (Computed totals are guarded in the RPC, which sees the
  // current balances; the schema can only bound the delta.)
  points: z
    .number()
    .int()
    .min(INT32_MIN)
    .max(INT32_MAX)
    .refine((value) => value !== 0, {
      message: 'points must be a non-zero integer',
    }),
  reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
  type: z.enum(MANUAL_POINTS_TYPES).default('adjust'),
});

export type LoyaltyManualPointsInput = z.infer<
  typeof loyaltyManualPointsSchema
>;

export const loyaltyManualPointsResultSchema = z.object({
  success: z.literal(true),
  new_balance: z.number(),
  lifetime_points: z.number(),
  points_awarded: z.number(),
});

export type LoyaltyManualPointsResult = z.infer<
  typeof loyaltyManualPointsResultSchema
>;
