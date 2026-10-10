import { z } from 'zod';
import { prefundedCardCheckoutSchemas } from './prefunded-card-checkout';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const snapshot = z
  .strictObject({
    intent: prefundedCardCheckoutSchemas.intent,
    phase: z.enum([
      'reserved',
      'initializing',
      'ready',
      'pending',
      'reconciliation_required',
      'funding_pending',
      'completed',
      'retired_unconfirmed',
    ]),
    session: prefundedCardCheckoutSchemas.session.nullable(),
    operationId: uuid.nullable(),
  })
  .superRefine((value, context) => {
    const promoted =
      value.phase === 'funding_pending' || value.phase === 'completed';
    if (
      (value.phase === 'ready') !== (value.session !== null) ||
      (value.session && value.session.reference !== value.intent.reference) ||
      (promoted
        ? value.operationId !== value.intent.intentId
        : value.operationId !== null)
    )
      context.addIssue({ code: 'custom', message: 'Checkout state mismatch' });
  });
const claim = z.strictObject({
  outcome: z.literal('claimed'),
  intent: prefundedCardCheckoutSchemas.intent,
  token: uuid,
  fence: z.number().int().positive().safe(),
  leaseExpiresAt: z.iso.datetime(),
});

export const prefundedCardCheckoutStateSchemas = {
  resultRows: z.array(z.strictObject({ result: z.unknown() })).length(1),
  acknowledged: z.literal(true),
  snapshot,
  claim,
  initialization: z.discriminatedUnion('outcome', [
    claim,
    z.strictObject({ outcome: z.literal('existing'), snapshot }),
  ]),
  verification: z.discriminatedUnion('outcome', [
    z.strictObject({ outcome: z.literal('pending') }),
    z.strictObject({ outcome: z.literal('reconciliation_required') }),
    z.strictObject({
      outcome: z.literal('verified'),
      collection: prefundedCardCheckoutSchemas.collection,
    }),
  ]),
};
