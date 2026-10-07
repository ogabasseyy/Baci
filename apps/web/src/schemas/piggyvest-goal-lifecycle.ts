import { z } from 'zod';
import { piggyvestGoalPolicySchemas } from './piggyvest-goal-policy';
import { piggyvestPostgresConfigurationSchema } from './piggyvest-postgres-configuration';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const configuration = {
  enabled: z.literal(true),
  scope: piggyvestGoalPolicySchemas.configuration,
  database: piggyvestPostgresConfigurationSchema.refine(
    (value) =>
      value.transport === 'local_test' &&
      value.role === 'piggyvest_staging_policy_writer'
  ),
};
const durationMonths = z.number().int().min(1).max(6);

export const piggyvestGoalLifecycleSchemas = {
  input: z.strictObject({
    ...configuration,
    command: z.strictObject({ operationId: uuid, revisionId: uuid }),
  }),
  termsInput: z.strictObject({
    ...configuration,
    command: z.discriminatedUnion('action', [
      z.strictObject({
        action: z.literal('prepare'),
        revisionId: uuid,
        durationMonths,
      }),
      z.strictObject({
        action: z.literal('accept'),
        revisionId: uuid,
        durationMonths,
        actorId: uuid,
        accepted: z.literal(true),
      }),
    ]),
  }),
  termsAcknowledgement: z
    .array(
      z.strictObject({
        result: z.strictObject({
          revisionId: uuid,
          durationMonths,
          outcome: z.enum(['prepared', 'accepted']),
        }),
      })
    )
    .length(1),
  acknowledgement: z
    .array(
      z.strictObject({
        result: z.strictObject({
          operationId: uuid,
          revisionId: uuid,
          lifecycle: z.literal('active'),
          activatedAt: z.iso.datetime({ offset: true }),
          guaranteeKobo: z.number().int().safe().positive(),
          collectionPaused: z.literal(true),
          collectionConsent: z.literal('not_granted'),
          evidence: z.literal('local_synthetic_only'),
          durationMonths,
          maturesAt: z.iso.datetime({ offset: true }),
          graceExpiresAt: z.iso.datetime({ offset: true }),
        }),
      })
    )
    .length(1),
};
