import { z } from 'zod';
import { piggyvestGoalPolicySchemas } from './piggyvest-goal-policy';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const unresolved = {
  periodStatus: z.literal('unknown'),
  coveredPeriod: z.null(),
  entitlement: z.literal('unresolved'),
  disposition: z.literal('unresolved'),
  financialEffects: z.literal('UNKNOWN'),
  fundsUse: z.literal('not_authorized'),
};
const identity = { goalId: uuid, ledgerOperationId: uuid };
const receipt = z.strictObject({
  ...identity,
  ...unresolved,
  recordedByActorId: uuid,
  recordedAt: z.iso.datetime({ offset: true }),
});
const snapshot = z.strictObject({
  ...identity,
  ...unresolved,
  record: receipt.nullable(),
  canonical: z.strictObject({
    kind: z.enum(['credit_eligible_paid_interest', 'record_pending_interest']),
    originalCreditKobo: z.number().int().safe().positive(),
    evidenceId: z.string().min(1).max(128),
    reversalOperationId: uuid.nullable(),
    evidence: z.literal('internal_ledger_only'),
  }),
  lifecycleEvidence: z.strictObject({
    reservationSeen: z.boolean(),
    settlementSeen: z.boolean(),
  }),
});
export const piggyvestPeriodRecoverySchemas = {
  configuration: piggyvestGoalPolicySchemas.configuration.extend({
    transport: z.literal('local_test'),
    actorId: uuid,
  }),
  command: z.strictObject({ ledgerOperationId: uuid }),
  receipt,
  snapshot,
  readRows: z.array(z.strictObject({ result: snapshot })).length(1),
  writeRows: z.array(z.strictObject({ result: receipt })).length(1),
};
