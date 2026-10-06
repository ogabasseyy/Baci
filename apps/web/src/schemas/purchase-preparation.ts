import { z } from 'zod';
import { cancelPlanSchemas } from './cancel-plan';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const kobo = z.number().int().safe().nonnegative();
const quote = z
  .strictObject({
    quoteId: uuid,
    revisionId: uuid,
    productId: uuid,
    variantId: uuid.nullable(),
    condition: z.string().min(1).max(128),
    currency: z.literal('NGN'),
    quantity: z.literal(1),
    termsVersion: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
    termsHash: z.string().regex(/^[0-9a-f]{64}$/),
    deviceKobo: kobo.positive(),
    deliveryKobo: kobo,
    taxKobo: kobo,
    feeKobo: kobo,
    totalKobo: kobo.positive(),
    savingsKobo: kobo.positive(),
    otherPaymentKobo: kobo,
    principalKobo: kobo,
    paidInterestKobo: kobo,
    surplusKobo: kobo,
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .refine(
    (value) =>
      value.totalKobo ===
        value.deviceKobo + value.deliveryKobo + value.taxKobo + value.feeKobo &&
      value.totalKobo === value.savingsKobo + value.otherPaymentKobo &&
      value.savingsKobo === value.principalKobo + value.paidInterestKobo
  );
const receipt = z.strictObject({
  status: z.literal('purchase_pending'),
  operationId: uuid,
  quoteId: uuid,
  savingsKobo: kobo.positive(),
  otherPaymentKobo: kobo,
  principalKobo: kobo,
  paidInterestKobo: kobo,
  surplusKobo: kobo,
  collectionPaused: z.literal(true),
  dispatch: z.literal('contract_gap'),
  fulfilment: z.literal('disabled'),
});
export const purchasePreparationSchemas = {
  configuration: cancelPlanSchemas.configuration,
  quote,
  receipt,
  confirmation: z.strictObject({
    operationId: uuid,
    accepted: z.literal(true),
    quote,
  }),
  selection: z.strictObject({ quoteId: uuid }),
  operation: z.strictObject({ operationId: uuid }),
  rows: z.array(z.strictObject({ result: quote })).length(1),
  receipts: z.array(z.strictObject({ result: receipt })).length(1),
};
