import { z } from 'zod';
import { piggyvestCustomerPolicyContextSchemas } from './piggyvest-customer-policy-context';
import { piggyvestScheduleStoreSchemas as store } from './piggyvest-schedule-store';

const uuid = store.receipt.shape.operationId;
const consent = store.receipt.shape.state.shape.consentProposal
  .unwrap()
  .omit({ actorId: true })
  .strip();
const state = z.object({
  version: store.receipt.shape.state.shape.version,
  status: store.receipt.shape.state.shape.status,
  consentProposal: consent.nullable(),
});
const receipt = store.receipt.extend({ state }).strip();
const common = {
  goalId: uuid,
  dispatch: z.literal('disabled'),
  debitPermission: z.literal(false),
};
export const piggyvestCustomerScheduleHandlerSchemas = {
  actor: piggyvestCustomerPolicyContextSchemas.actor,
  read: z.strictObject({ goalId: uuid, operationId: uuid.optional() }),
  request: store.request,
  snapshot: z.strictObject({
    ...common,
    status: z.literal('available'),
    revisionId: uuid,
    termsHash: z.string().regex(/^[0-9a-f]{64}$/),
    state,
    historical: z
      .strictObject({ command: store.request.shape.command, receipt })
      .nullable(),
  }),
  success: z.strictObject({
    ...common,
    status: z.literal('persisted_proposal'),
    receipt,
  }),
  uncertain: z.strictObject({
    ...common,
    status: z.literal('unconfirmed'),
    operationId: uuid,
    readbackRequired: z.literal(true),
  }),
};
