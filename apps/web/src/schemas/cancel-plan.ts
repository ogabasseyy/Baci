import { z } from 'zod';
import { piggyvestGoalPolicySchemas } from './piggyvest-goal-policy';
import { piggyvestSavingsLedgerSnapshotSchema } from './piggyvest-savings-ledger-snapshot';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const kobo = z.number().int().safe().nonnegative();
const policySpecific = z.strictObject({
  status: z.literal('requires_policy_specific_handling'),
});

export const cancelPlanSchemas = {
  configuration: piggyvestGoalPolicySchemas.configuration.extend({
    transport: z.literal('local_test'),
    actorId: uuid,
  }),
  confirmation: z.strictObject({
    operationId: uuid,
    actorId: uuid,
    revisionId: uuid,
    termsVersion: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
    termsHash: z.string().regex(/^[0-9a-f]{64}$/),
    consentVersion: z.literal('2026-09-11'),
    accepted: z.literal(true),
    principalKobo: kobo.positive(),
    paidInterestKobo: kobo,
    pendingInterestKobo: kobo,
  }),
  source: z
    .array(
      z.strictObject({
        result: z.union([
          policySpecific,
          z.strictObject({
            policy:
              piggyvestGoalPolicySchemas.read.element.shape.result.unwrap(),
            ledgerSnapshot: piggyvestSavingsLedgerSnapshotSchema,
          }),
        ]),
      })
    )
    .length(1),
  prepared: z
    .array(
      z.strictObject({
        result: z.strictObject({
          status: z.literal('prepared'),
          operationId: uuid,
          collectionPaused: z.literal(true),
          dispatch: z.literal('contract_gap'),
          interestDisposition: z.literal('unresolved'),
        }),
      })
    )
    .length(1),
};
