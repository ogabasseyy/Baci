import { z } from 'zod';
import { piggyvestFundingDisplaySchema } from './piggyvest-funding-display';
import { piggyvestPolicyReviewSchemas } from './piggyvest-policy-review';

const sessionKey = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => value.trim().length > 0);
const kobo = z.number().int().safe().nonnegative();
const policy = piggyvestPolicyReviewSchemas.view.options[0];

export const piggyvestSavingsScreenSchema = z.discriminatedUnion('status', [
  z.strictObject({
    environment: z.literal('staging'),
    status: z.enum(['loading', 'unavailable', 'unauthenticated']),
  }),
  z
    .strictObject({
      environment: z.literal('staging'),
      status: z.literal('ready'),
      sessionKey,
      goalId: z.uuid(),
      policy,
      eligibility: z.discriminatedUnion('status', [
        z.strictObject({
          status: z.enum(['blocked', 'pending', 'unavailable']),
        }),
        z.strictObject({
          status: z.literal('allowed'),
          sessionKey,
          goalId: z.uuid(),
          revisionId: z.uuid(),
          termsHash: policy.shape.terms.shape.hash,
          termsVersion: policy.shape.terms.shape.version,
        }),
      ]),
      funding: piggyvestFundingDisplaySchema,
      progress: z.discriminatedUnion('status', [
        z.strictObject({
          status: z.enum(['loading', 'pending_wallet', 'unavailable']),
        }),
        z.strictObject({
          status: z.literal('ready'),
          decision: z.strictObject({
            purchasingPowerKobo: kobo,
            devicePriceKobo: kobo,
            readiness: z.enum([
              'continue_saving',
              'ready_for_review',
              'review_required',
              'not_available',
            ]),
            purchaseAction: z.enum([
              'not_available',
              'requires_customer_confirmation',
              'blocked',
            ]),
          }),
          pendingInterestKobo: kobo.nullable(),
        }),
      ]),
    })
    .refine((source) => source.goalId === source.policy.goalId),
]);

export type SavingsScreenSource = z.infer<typeof piggyvestSavingsScreenSchema>;
