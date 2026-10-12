import { z } from 'zod';
import { prefundedCardClaimedRequestSchema } from './prefunded-card-claimed-request';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const claim = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('stale_or_reconciliation_required') }),
  z.strictObject({
    outcome: z.literal('claimed'),
    operationId: uuid,
    fence: z.number().int().positive(),
    request: prefundedCardClaimedRequestSchema,
  }),
]);

export const prefundedCardOperationStoreSchemas = {
  uuid,
  claimFence: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  commitFence: z.number().int().positive(),
  reservationRows: z
    .array(
      z.strictObject({
        result: z.strictObject({
          operationId: uuid,
          outcome: z.literal('reserved'),
          collectionStatus: z.string(),
          transferStatus: z.string(),
        }),
      })
    )
    .length(1),
  claimRows: z.array(z.strictObject({ result: claim })).length(1),
  collectionResultRows: z
    .array(
      z.strictObject({
        result: z.enum([
          'stale',
          'unknown',
          'reconciliation_required',
          'verified_failed',
          'verified_success',
        ]),
      })
    )
    .length(1),
  transferResultRows: z
    .array(
      z.strictObject({
        result: z.enum([
          'stale',
          'unknown',
          'reconciliation_required',
          'verified_success',
        ]),
      })
    )
    .length(1),
  reconciliationRows: z
    .array(
      z.strictObject({
        result: z.discriminatedUnion('outcome', [
          z.strictObject({ outcome: z.literal('leased') }),
          z.strictObject({ outcome: z.literal('not_verifiable') }),
          claim.options[1].omit({ outcome: true }).extend({
            outcome: z.literal('verify_only'),
            token: uuid,
            leg: z.enum(['collection', 'transfer']),
          }),
        ]),
      })
    )
    .length(1),
  reconciliationCompletionRows: z
    .array(
      z.strictObject({
        result: z.enum([
          'stale',
          'verified_success',
          'verified_failed',
          'reconciliation_required',
        ]),
      })
    )
    .length(1),
  command: z
    .strictObject({
      operationId: uuid,
      integrationId: uuid,
      merchantId: uuid,
      customerId: uuid,
      goalId: uuid,
      treasuryBindingId: uuid,
      requestFingerprint: z.string().min(16).max(255),
      idempotencyKey: z.string().min(16).max(255),
      savedMethodId: uuid,
      amountKobo: z.number().int().positive().safe(),
      feeAllowanceKobo: z.literal(0),
      currency: z.literal('NGN'),
      collectionReference: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
      transferReference: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
      destinationWalletId: z.string().min(1).max(512),
      destinationCustomerId: z.string().min(1).max(512),
    })
    .refine((value) => value.collectionReference !== value.transferReference),
};
