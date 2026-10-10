import { z } from 'zod';

const MAX_REASON_LENGTH = 500;

// Manual awards are always plain adjustments: points_transactions.type
// has no CHECK constraint, so any other label (earn, redemption, bonus,
// referral, expiry) would forge ledger rows that corrupt expiry and
// redemption accounting.
const MANUAL_POINTS_TYPES = ['adjust'] as const;

export const loyaltyManualPointsSchema = z.object({
  customerId: z.uuid(),
  // points_transactions.points is an integer column: fractional values
  // would 500 on insert, and zero-point adjustments are no-ops.
  points: z
    .number()
    .int()
    .refine((value) => value !== 0, {
      message: 'points must be a non-zero integer',
    }),
  reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
  type: z.enum(MANUAL_POINTS_TYPES).default('adjust'),
});

export type LoyaltyManualPointsInput = z.infer<
  typeof loyaltyManualPointsSchema
>;
