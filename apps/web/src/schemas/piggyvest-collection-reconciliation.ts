import { z } from 'zod';
import { piggyvestGoalPolicySchemas } from './piggyvest-goal-policy';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';
import { piggyvestSavingsLedgerSnapshotSchema } from './piggyvest-savings-ledger-snapshot';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const reference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const status = z.enum(['pending', 'unknown']);
const receipt = z.strictObject({
  operationId: uuid,
  observationId: uuid,
  goalId: uuid,
  status,
  financialEffects: z.literal('UNKNOWN'),
  dispatch: z.literal('disabled'),
  debitPermission: z.literal(false),
});
const snapshot = z.strictObject({
  operationId: uuid,
  goalId: uuid,
  current: z
    .strictObject({ status, financialEffects: z.literal('UNKNOWN') })
    .nullable(),
  historical: receipt.nullable(),
  ledger: piggyvestSavingsLedgerSnapshotSchema,
  ledgerEvidence: z
    .strictObject({
      operationId: uuid,
      principalKobo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      evidence: z.literal('internal_ledger_only'),
      fundsUse: z.literal('not_authorized'),
    })
    .nullable(),
});
export const piggyvestCollectionReconciliationSchemas = {
  configuration: piggyvestGoalPolicySchemas.configuration.extend({
    transport: z.literal('local_test'),
    actorId: uuid,
  }),
  command: z.strictObject({
    operationId: uuid,
    observationId: uuid,
    collectionReference: reference,
    evidenceId: reference,
    providerWalletId: piggyvestProviderIdSchema,
    providerCustomerId: piggyvestProviderIdSchema,
    observation: status,
  }),
  lookup: z.strictObject({
    operationId: uuid,
    observationId: uuid.nullable().default(null),
  }),
  receipt,
  snapshot,
  readRows: z.array(z.strictObject({ result: snapshot })).length(1),
  writeRows: z.array(z.strictObject({ result: receipt })).length(1),
};
