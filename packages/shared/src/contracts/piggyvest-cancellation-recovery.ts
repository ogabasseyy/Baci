import { z } from 'zod';
import { piggyvestCancellationReviewSchemas } from './piggyvest-cancellation-review';

const uuid = z.uuid();
const common = {
  goalId: uuid,
  requestedOperationId: uuid.nullable(),
  retry: z.literal('not_authorized'),
  dispatch: z.literal('contract_gap'),
};
const disclosure = piggyvestCancellationReviewSchemas.confirmation.omit({
  goalId: true,
  operationId: true,
  accepted: true,
});

export const piggyvestCancellationRecoverySchemas = {
  request: z.strictObject({ goalId: uuid, operationId: uuid.optional() }),
  response: z
    .discriminatedUnion('status', [
      z.strictObject({
        ...common,
        status: z.literal('prepared'),
        operationId: uuid,
        reservation: z.literal('retained'),
        interestDisposition: z.literal('unresolved'),
        originalDisclosure: disclosure,
      }),
      z.strictObject({
        ...common,
        status: z.literal('absent'),
        operationId: z.null(),
        reservation: z.literal('unknown'),
      }),
      z.strictObject({
        ...common,
        status: z.literal('requires_reconciliation'),
        operationId: uuid,
        reservation: z.literal('unknown'),
        interestDisposition: z.literal('unresolved'),
      }),
      z.strictObject({
        ...common,
        status: z.literal('unavailable'),
        operationId: z.null(),
        reservation: z.literal('may_be_retained'),
      }),
    ])
    .refine(
      (value) =>
        value.operationId === null ||
        value.requestedOperationId === null ||
        value.operationId.toLowerCase() ===
          value.requestedOperationId.toLowerCase()
    ),
};
