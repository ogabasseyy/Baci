import { z } from 'zod';

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
    credited_interest_kobo: creditedInterestKoboSchema,
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
