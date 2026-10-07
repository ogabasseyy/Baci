import { z } from 'zod';
import { piggyvestStagingConfigurationSchema } from './piggyvest-staging-configuration';
import { prefundedCardKnownDeadlineSchema } from './prefunded-card-known-deadline';

export const PREFUNDED_TREASURY_SYSTEM_IDENTIFIER = '7685292944002592802';
export const PREFUNDED_TREASURY_EXPIRES_AT = prefundedCardKnownDeadlineSchema;

export const prefundedCardTreasuryVerifierSchema = z
  .strictObject({
    environment: z.literal('staging'),
    systemIdentifier: z.literal(PREFUNDED_TREASURY_SYSTEM_IDENTIFIER),
    expiresAt: PREFUNDED_TREASURY_EXPIRES_AT,
    treasuryBindingId: z.uuid(),
    expectedBusinessId: z.string().trim().min(1).max(512),
    sourceWalletId: z.string().trim().min(1).max(512),
    piggyvest: piggyvestStagingConfigurationSchema,
  })
  .superRefine((value, context) => {
    if (value.piggyvest.expectedBusinessId !== value.expectedBusinessId) {
      context.addIssue({
        code: 'custom',
        path: ['piggyvest', 'expectedBusinessId'],
        message: 'Provider business does not match treasury business',
      });
    }
    if (value.piggyvest.expectedCurrency !== 'NGN') {
      context.addIssue({
        code: 'custom',
        path: ['piggyvest', 'expectedCurrency'],
        message: 'Treasury snapshots require NGN',
      });
    }
  });

export type PrefundedCardTreasuryVerifierConfiguration = z.infer<
  typeof prefundedCardTreasuryVerifierSchema
>;
