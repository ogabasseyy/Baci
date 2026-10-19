import { z } from 'zod';

const uuid = z.uuid();
const kobo = z.number().int().safe().nonnegative();
const assertions = {
  goalId: uuid,
  revisionId: uuid,
  termsVersion: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  termsHash: z.string().regex(/^[0-9a-f]{64}$/),
  consentVersion: z.literal('2026-09-11'),
  principalKobo: kobo.positive(),
  paidInterestKobo: kobo,
  pendingInterestKobo: kobo,
};

export const piggyvestCancellationReviewSchemas = {
  quote: z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('quote_available'),
      ...assertions,
      interestDisposition: z.literal('unresolved'),
      dispatch: z.literal('contract_gap'),
    }),
    z.strictObject({ status: z.literal('unavailable'), goalId: uuid }),
    z.strictObject({
      status: z.literal('requires_policy_specific_handling'),
      goalId: uuid,
    }),
  ]),
  confirmation: z.strictObject({
    ...assertions,
    operationId: uuid,
    accepted: z.literal(true),
  }),
  receipt: z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('prepared'),
      goalId: uuid,
      operationId: uuid,
      collectionPaused: z.literal(true),
      dispatch: z.literal('contract_gap'),
      interestDisposition: z.literal('unresolved'),
    }),
    z.strictObject({
      status: z.literal('unavailable'),
      goalId: uuid,
      operationId: uuid,
      reservation: z.literal('may_be_retained'),
      dispatch: z.literal('contract_gap'),
    }),
  ]),
};
