import { z } from 'zod';
import { prefundedCardCheckoutSchemas } from './prefunded-card-checkout';
import { prefundedCardTransferVerificationSchemas } from './prefunded-card-transfer-verification';

const uuid = z.uuid();
const identifier = prefundedCardTransferVerificationSchemas.identifier;
const scope = z.strictObject({
  environment: z.literal('staging'),
  integrationId: uuid,
  merchantId: uuid,
  customerId: uuid,
});
const reservation = scope
  .extend({
    operationId: uuid,
    intentId: uuid,
    amountKobo: z.number().int().positive().safe(),
    currency: z.literal('NGN'),
    email: z.email(),
    businessId: identifier,
    sourceWalletId: identifier,
    destinationWalletId: identifier,
    destinationCustomerId: identifier,
    collectionReference:
      prefundedCardCheckoutSchemas.collection.shape.reference,
    transferReference: identifier,
  })
  .refine(
    (value) =>
      value.collectionReference === `pvb-first-${value.intentId}` &&
      value.sourceWalletId !== value.destinationWalletId &&
      value.collectionReference !== value.transferReference
  );

export const primaryWalletCardFundingSchemas = {
  scope,
  selection: scope.extend({ operationId: uuid }),
  reservation,
  collection: z.discriminatedUnion('outcome', [
    z.strictObject({
      outcome: z.literal('verified'),
      collection: prefundedCardCheckoutSchemas.collection,
    }),
    z.strictObject({ outcome: z.literal('pending') }),
    z.strictObject({ outcome: z.literal('reconciliation_required') }),
  ]),
  transfer: prefundedCardTransferVerificationSchemas.normalized,
  acknowledgement: z.enum(['credited', 'duplicate', 'conflict']),
};
