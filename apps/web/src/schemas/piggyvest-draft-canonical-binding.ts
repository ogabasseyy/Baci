import { z } from 'zod';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const selection = z.strictObject({
  draftId: uuid,
  draftRevisionId: uuid,
  policyRevisionId: uuid,
});
const receipt = selection.extend({
  goalId: uuid,
  outcome: z.literal('bound'),
  boundAt: z.iso.datetime({ offset: true }),
});

export const piggyvestDraftCanonicalBindingSchemas = {
  configuration: z.strictObject({
    transport: z.literal('local_test'),
    database: z.literal('piggyvest_local'),
    role: z.literal('piggyvest_staging_policy_writer'),
    integrationId: uuid,
    merchantId: uuid,
    customerId: uuid,
    goalId: uuid,
    expectedBusinessId: z.string().min(1).max(512),
    actorId: uuid,
  }),
  selection,
  receipt,
  result: z.array(z.strictObject({ result: receipt })).length(1),
};
