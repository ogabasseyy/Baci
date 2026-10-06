import { z } from 'zod';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const amountKobo = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const reference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const walletId = z.string().min(1).max(255);

const operation = z
  .strictObject({
    operationId: uuid,
    integrationId: uuid,
    merchantId: uuid,
    customerId: uuid,
    goalId: uuid,
    treasuryBindingId: uuid,
    savedMethodId: uuid,
    amountKobo,
    feeAllowanceKobo: z.literal(0),
    currency: z.literal('NGN'),
    requestFingerprint: z.string().min(16).max(255),
    collectionReference: reference,
    transferReference: reference,
    sourceWalletId: walletId,
    destinationWalletId: walletId,
  })
  .superRefine((value, context) => {
    if (value.collectionReference === value.transferReference)
      context.addIssue({ code: 'custom', message: 'References must differ' });
    if (value.sourceWalletId === value.destinationWalletId)
      context.addIssue({ code: 'custom', message: 'Wallets must differ' });
    if (!Number.isSafeInteger(value.amountKobo + value.feeAllowanceKobo))
      context.addIssue({ code: 'custom', message: 'Total exceeds safe range' });
  });

const preflight = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('reserved'),
    reservationId: uuid,
    operationId: uuid,
    availableGoalCapacityKobo: amountKobo,
    availableFloatKobo: amountKobo,
    reservedTotalKobo: amountKobo,
  }),
  z.strictObject({
    status: z.enum([
      'unavailable',
      'goal_capacity_insufficient',
      'float_insufficient',
    ]),
  }),
]);

const collection = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.enum([
      'not_started',
      'dispatching',
      'action_required',
      'pending',
      'unknown',
      'verified_failed',
      'reversed',
    ]),
  }),
  z.strictObject({
    status: z.literal('verified_success'),
    reference,
    amountKobo,
    currency: z.literal('NGN'),
    savedMethodId: uuid,
  }),
]);

const transfer = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.enum([
      'not_started',
      'dispatching',
      'pending',
      'unknown',
      'verified_failed',
    ]),
  }),
  z.strictObject({
    status: z.literal('verified_success'),
    reference,
    providerTransactionId: z.string().min(1).max(255),
    amountKobo,
    currency: z.literal('NGN'),
    sourceWalletId: walletId,
    destinationWalletId: walletId,
  }),
]);

const completion = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unclaimed') }),
  z.strictObject({
    status: z.literal('projection_confirmed'),
    projectionId: uuid,
    operationId: uuid,
    integrationId: uuid,
    merchantId: uuid,
    customerId: uuid,
    goalId: uuid,
    treasuryBindingId: uuid,
    requestFingerprint: z.string().min(16).max(255),
    providerTransactionId: z.string().min(1).max(255),
    amountKobo,
    currency: z.literal('NGN'),
  }),
]);

export const prefundedCardContributionSchemas = {
  input: z
    .strictObject({
      operation,
      preflight,
      collection,
      transfer,
      completion,
      transferContract: z.enum(['unverified', 'captured_and_reviewed']),
    })
    .superRefine((value, context) => {
      const total =
        value.operation.amountKobo + value.operation.feeAllowanceKobo;
      if (value.preflight.status !== 'reserved') return;
      if (
        value.preflight.operationId !== value.operation.operationId ||
        value.preflight.reservedTotalKobo !== total ||
        value.preflight.availableGoalCapacityKobo <
          value.operation.amountKobo ||
        value.preflight.availableFloatKobo < total
      )
        context.addIssue({ code: 'custom', message: 'Preflight mismatch' });
    }),
};
