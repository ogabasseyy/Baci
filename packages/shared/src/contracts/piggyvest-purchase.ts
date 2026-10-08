import { z } from 'zod';
import { piggyvestPaymentLegRecoverySchema } from './piggyvest-payment-leg-recovery';

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
const selection = z.strictObject({
  goalId: uuid,
  quoteId: uuid,
  shippingRateId: uuid,
  savingsKobo: kobo.positive(),
  fulfilmentMode: z.literal('pickup'),
});
const published = z.strictObject({
  status: z.literal('quote_available'),
  goalId: uuid,
  fulfilmentMode: z.literal('pickup'),
  shippingRateId: uuid,
  pickupName: z.string().min(1).max(200),
  pickupAddress: z.strictObject({
    address: z.string().min(1).max(4096),
    city: z.string().min(1).max(1024),
    countryCode: z.literal('NG'),
  }),
  taxTreatment: z.enum([
    'exclusive_device',
    'included_device',
    'not_applicable',
  ]),
  includedTaxKobo: kobo,
  feePolicyVersion: z.string().min(1).max(64),
  quote,
});
const confirmation = z.strictObject({
  goalId: uuid,
  operationId: uuid,
  accepted: z.literal(true),
  fulfilmentMode: z.literal('pickup'),
  quote,
});
const receipt = z.strictObject({
  status: z.literal('purchase_pending'),
  goalId: uuid,
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
const observation = {
  observedAt: z.iso.datetime({ offset: true }),
  evidence: z.literal('internal_ledger_only'),
  fundsUse: z.literal('not_authorized'),
  retry: z.literal('not_authorized'),
};
const current = z.discriminatedUnion('status', [
  z.strictObject({
    ...observation,
    status: z.literal('observed'),
    reservation: z.literal('retained'),
    balances: z
      .strictObject({
        unreservedPrincipalKobo: kobo,
        unreservedPaidInterestKobo: kobo,
        pendingInterestKobo: kobo,
      })
      .refine((value) =>
        Number.isSafeInteger(
          value.unreservedPrincipalKobo + value.unreservedPaidInterestKobo
        )
      ),
  }),
  z.strictObject({
    ...observation,
    status: z.literal('requires_reconciliation'),
    reservation: z.literal('unknown'),
    balances: z.null(),
  }),
]);
export const piggyvestPurchaseSchemas = {
  selection,
  quote,
  published,
  confirmation,
  receipt,
  statusRequest: z.strictObject({ goalId: uuid, operationId: uuid }),
  paymentLegRecovery: piggyvestPaymentLegRecoverySchema,
  status: receipt
    .extend({
      current,
      paymentLegRecovery: piggyvestPaymentLegRecoverySchema.optional(),
    })
    .superRefine((value, context) => {
      const legs = value.paymentLegRecovery?.legs;
      if (
        legs &&
        (legs[0].operationId !== value.operationId ||
          legs[0].amountKobo !== value.savingsKobo ||
          legs[1].amountKobo !== value.otherPaymentKobo)
      )
        context.addIssue({
          code: 'custom',
          message: 'Recovery must retain intent identity and amounts',
        });
    }),
};
