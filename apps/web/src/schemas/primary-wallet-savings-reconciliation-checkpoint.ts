import { z } from 'zod';
import { piggyvestPrimarySavingsTransferSchemas } from './piggyvest-primary-savings-transfer';

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const stateShape = z.object({
  stage: z.enum(['date-window', 'full']).nullable(),
  fingerprint: digest.nullable(),
  cursor: z.string().min(1).max(512).nullable(),
  pageDigest: digest.nullable(),
});
const state = stateShape.refine((value) => {
  const empty =
    value.stage === null &&
    value.fingerprint === null &&
    value.cursor === null &&
    value.pageDigest === null;
  const complete =
    value.stage !== null &&
    value.fingerprint !== null &&
    value.cursor !== null &&
    value.pageDigest !== null;
  return empty || complete;
});

const emptyState = {
  stage: null,
  fingerprint: null,
  cursor: null,
  pageDigest: null,
} as const;

export const primaryWalletSavingsReconciliationCheckpointSchemas = {
  emptyState,
  state,
  claim: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('stale') }),
    z.strictObject({ status: z.literal('busy') }),
    z.strictObject({
      status: z.literal('acquired'),
      claimToken: z.string().uuid(),
      state,
    }),
  ]),
  saved: z.boolean(),
  saveCommand: z.strictObject({
    operationId:
      piggyvestPrimarySavingsTransferSchemas.request.shape.operationId,
    claimToken: z.string().uuid(),
    ...stateShape.shape,
  }),
  finishCommand: z.strictObject({
    operationId:
      piggyvestPrimarySavingsTransferSchemas.request.shape.operationId,
    claimToken: z.string().uuid(),
    reset: z.boolean(),
  }),
};
