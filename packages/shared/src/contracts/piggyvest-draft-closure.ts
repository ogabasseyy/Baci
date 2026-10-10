import { z } from 'zod';

const goalId = z.uuid();
const revision = {
  goalId,
  revisionId: z.uuid(),
  termsVersion: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  termsHash: z.string().regex(/^[0-9a-f]{64}$/),
};
const close = z.strictObject({
  ...revision,
  operationId: z.uuid(),
  accepted: z.literal(true),
});
const read = z.strictObject({ goalId });
const response = z.discriminatedUnion('status', [
  z.strictObject({
    ...revision,
    status: z.literal('available'),
    action: z.literal('close_plan'),
  }),
  z.strictObject({
    ...revision,
    status: z.literal('closed'),
    operationId: z.uuid(),
    closedAt: z.iso.datetime({ offset: true }),
    action: z.literal('close_plan'),
    refundIssued: z.literal(false),
    providerWalletDeleted: z.literal(false),
  }),
  z.strictObject({
    status: z.literal('requires_reconciliation'),
    goalId,
    reason: z.literal('provider_zero_unverified'),
  }),
  z.strictObject({ status: z.literal('unavailable'), goalId }),
]);

export const piggyvestDraftClosureSchemas = { read, close, response };
