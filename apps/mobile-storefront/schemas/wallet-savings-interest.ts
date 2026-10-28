import { z } from 'zod';
import { SavingsInterestActivitySchema } from './savings-interest-activity';

const creditedInterestKoboSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const WalletSavingsInterestRequestSchema = z.strictObject({
  p_merchant_id: z.uuid(),
  p_include_goals: z.literal(true),
});

export const WalletSavingsInterestResponseSchema = z
  .strictObject({
    earnings_available: z.boolean().optional(),
    credited_interest_kobo: creditedInterestKoboSchema.nullable(),
    interest_history: z.array(SavingsInterestActivitySchema).max(20).optional(),
    goal_interest_kobo: z
      .array(
        z.strictObject({
          goal_id: z.uuid(),
          credited_interest_kobo: creditedInterestKoboSchema,
        })
      )
      .max(1000),
  })
  .superRefine((response, context) => {
    if (response.earnings_available === false) {
      if (response.credited_interest_kobo !== null) {
        context.addIssue({
          code: 'custom',
          message: 'Unavailable earnings must not carry a numeric balance',
          path: ['credited_interest_kobo'],
        });
      }
      if (response.goal_interest_kobo.length > 0) {
        context.addIssue({
          code: 'custom',
          message: 'Unavailable earnings must not carry goal balances',
          path: ['goal_interest_kobo'],
        });
      }
      if (!response.interest_history) {
        context.addIssue({
          code: 'custom',
          message: 'History-only responses must include interest history',
          path: ['interest_history'],
        });
      }
      return;
    }
    if (response.credited_interest_kobo === null) {
      context.addIssue({
        code: 'custom',
        message: 'Available earnings must include a numeric balance',
        path: ['credited_interest_kobo'],
      });
      return;
    }
    const goalIds = new Set<string>();
    let goalInterestTotal = 0n;
    response.goal_interest_kobo.forEach((entry, index) => {
      if (goalIds.has(entry.goal_id)) {
        context.addIssue({
          code: 'custom',
          message: 'Goal interest entries must have unique goal IDs',
          path: ['goal_interest_kobo', index, 'goal_id'],
        });
      }
      goalIds.add(entry.goal_id);
      goalInterestTotal += BigInt(entry.credited_interest_kobo);
    });
    if (goalInterestTotal > BigInt(response.credited_interest_kobo)) {
      context.addIssue({
        code: 'custom',
        message: 'Goal interest cannot exceed aggregate credited interest',
        path: ['goal_interest_kobo'],
      });
    }
  });

export type WalletSavingsInterestResponse = z.infer<
  typeof WalletSavingsInterestResponseSchema
>;
