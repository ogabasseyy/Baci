import { z } from 'zod';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const version = z.number().int().safe().nonnegative();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const consent = z.strictObject({
  operationId: uuid,
  revisionId: uuid,
  termsHash: hash,
});
const state = z
  .strictObject({
    version,
    status: z.enum(['paused', 'resume_proposed', 'review_required', 'stopped']),
    consentProposal: consent.nullable(),
  })
  .refine(
    (value) =>
      (value.status === 'resume_proposed') === (value.consentProposal !== null)
  );
const correlation = { goalId: uuid, expectedVersion: version };
const command = z.discriminatedUnion('action', [
  z.strictObject({ ...correlation, action: z.literal('observe') }),
  z.strictObject({ ...correlation, action: z.literal('pause') }),
  z.strictObject({
    ...correlation,
    action: z.literal('request_resume'),
    operationId: uuid,
    revisionId: uuid,
    termsHash: hash,
    accepted: z.literal(true),
  }),
]);
const request = z
  .strictObject({ operationId: uuid, command })
  .refine(
    (value) =>
      value.command.action !== 'request_resume' ||
      value.operationId === value.command.operationId
  );
const disabled = {
  dispatch: z.literal('disabled'),
  debitPermission: z.literal(false),
};
const receipt = z.strictObject({
  operationId: uuid,
  state,
  persisted: z.literal(true),
  ...disabled,
});
const snapshot = z.strictObject({
  goalId: uuid,
  ...disabled,
  status: z.literal('available'),
  revisionId: uuid,
  termsHash: hash,
  state,
  historical: z.strictObject({ command, receipt }).nullable(),
});
const result = z.discriminatedUnion('status', [
  z.strictObject({
    goalId: uuid,
    ...disabled,
    status: z.literal('persisted_proposal'),
    receipt,
  }),
  z.strictObject({
    goalId: uuid,
    ...disabled,
    status: z.literal('unconfirmed'),
    operationId: uuid,
    readbackRequired: z.literal(true),
  }),
]);

export const piggyvestScheduleReviewSchemas = {
  read: z.strictObject({ goalId: uuid, operationId: uuid.optional() }),
  state,
  command,
  request,
  receipt,
  snapshot,
  result,
};
