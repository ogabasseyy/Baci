import { z } from 'zod';
import { piggyvestSavingsPolicyInputSchema } from './piggyvest-savings-policy';

const identity = z.uuid().transform((value) => value.toLowerCase());
const version = z.number().int().nonnegative().safe();
const scope = z.strictObject({
  integrationId: identity,
  merchantId: identity,
  customerId: identity,
  goalId: identity,
});
const consent = z.strictObject({
  actorId: identity,
  operationId: identity,
  revisionId: identity,
  termsHash: z.string().regex(/^[0-9a-f]{64}$/),
});
const state = z
  .strictObject({
    scope,
    version,
    status: z.enum(['paused', 'resume_proposed', 'review_required', 'stopped']),
    consentProposal: consent.nullable(),
  })
  .refine(
    (value) =>
      (value.status === 'resume_proposed') === (value.consentProposal !== null)
  );
const correlation = { goalId: identity, expectedVersion: version };
const command = z.discriminatedUnion('action', [
  z.strictObject({ ...correlation, action: z.literal('observe') }),
  z.strictObject({ ...correlation, action: z.literal('pause') }),
  z.strictObject({
    ...correlation,
    action: z.literal('request_resume'),
    operationId: identity,
    revisionId: identity,
    termsHash: z.string().regex(/^[0-9a-f]{64}$/),
    accepted: z.literal(true),
  }),
]);
const input = z
  .strictObject({
    trusted: z.strictObject({
      environment: z.literal('staging'),
      transport: z.literal('local_test'),
      scope,
      actorId: identity,
      collectionOwner: z.enum(['none', 'paystack', 'piggyvest']),
      revisionId: identity,
      termsHash: z.string().regex(/^[0-9a-f]{64}$/),
      policy: piggyvestSavingsPolicyInputSchema,
      maturity: z
        .strictObject({
          maturesAt: z.iso.datetime({ offset: true }),
          graceExpiresAt: z.iso.datetime({ offset: true }),
        })
        .nullable(),
    }),
    state,
    command,
  })
  .superRefine(({ trusted }, context) => {
    const maturity = trusted.maturity;
    if (
      trusted.policy.requestedAction !== 'none' ||
      (maturity &&
        (Date.parse(maturity.maturesAt) >=
          Date.parse(maturity.graceExpiresAt) ||
          Date.parse(trusted.policy.maturityGraceExpiresAt ?? '') !==
            Date.parse(maturity.graceExpiresAt))) ||
      (!maturity &&
        (trusted.policy.goalState !== 'draft' ||
          trusted.policy.maturityGraceExpiresAt !== undefined))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Inconsistent authoritative lifecycle snapshot',
      });
    }
  });

export const piggyvestScheduleLifecycleSchemas = { input, state, command };
