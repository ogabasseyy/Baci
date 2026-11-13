import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

const proof = z.string().regex(/^[0-9a-f]{64}$/);
// The shared ledger / reconciliation bound for one PiggyVest savings amount.
export const GOAL_CANCEL_MAX_AMOUNT_KOBO = 9999999999;
const amountKobo = z.int().positive().max(GOAL_CANCEL_MAX_AMOUNT_KOBO);

// Cancel is two customer steps: the server issues a per-attempt operation id,
// then the customer submits it with the PIN proof bound to that id. The
// provider reference is per goal, so an attempt id never reaches the provider.
const cancelReservation = z.strictObject({
  operationId: z.uuid(),
  goalId: z.uuid(),
  sourceWalletId: piggyvestProviderIdSchema,
  destinationWalletId: piggyvestProviderIdSchema,
  reference: z.string().min(1).max(200),
  businessId: piggyvestProviderIdSchema,
  providerCustomerId: piggyvestProviderIdSchema,
});

export const piggyvestGoalCancelSchemas = {
  httpRequest: z.discriminatedUnion('step', [
    z.strictObject({
      step: z.literal('issue'),
      merchantId: z.uuid(),
      goalId: z.uuid(),
    }),
    z.strictObject({
      step: z.literal('submit'),
      merchantId: z.uuid(),
      goalId: z.uuid(),
      operationId: z.uuid(),
      pinProof: proof,
    }),
  ]),
  statusRequest: z.strictObject({
    merchantId: z.uuid(),
    operationId: z.uuid(),
  }),
  operationId: z.uuid(),
  goalId: z.uuid(),
  reference: z.string().min(1).max(200),
  pinProof: proof,
  amountKobo,
  reservation: cancelReservation,
  dispatchedReservation: cancelReservation.extend({ amountKobo }),
  wallet: z.object({
    id: piggyvestProviderIdSchema,
    api_customer_id: piggyvestProviderIdSchema,
    business_id: piggyvestProviderIdSchema,
    currency: z.literal('NGN'),
    status: z.literal('active'),
    // Unbounded on purpose: a balance above the dispatch ceiling must parse so
    // the transfer step can release the reservation cleanly (too_large).
    balance: z.int().nonnegative(),
  }),
  issueRows: z
    .array(
      z.strictObject({
        result: z.discriminatedUnion('status', [
          z.strictObject({
            status: z.literal('issued'),
            operationId: z.uuid(),
            expiresAt: z.string(),
          }),
          z.strictObject({
            status: z.literal('pending'),
            operationId: z.uuid(),
          }),
          z.strictObject({ status: z.literal('busy') }),
          z.strictObject({ status: z.literal('needs_review') }),
          // The goal's PiggyVest setup never finished: nothing to cancel.
          z.strictObject({ status: z.literal('not_set_up') }),
        ]),
      })
    )
    .length(1),
  reservationRows: z
    .array(
      z.strictObject({
        result: z.discriminatedUnion('status', [
          z.strictObject({
            status: z.literal('claimed'),
            reservation: z.unknown(),
          }),
          z.strictObject({
            status: z.literal('pin_refused'),
            reason: z.enum([
              'missing',
              'invalid',
              'mismatch',
              'used',
              'expired',
              'unavailable',
            ]),
          }),
          z.strictObject({
            status: z.enum([
              'pending',
              'confirmed',
              'conflict',
              'expired',
              'busy',
              'needs_review',
            ]),
          }),
        ]),
      })
    )
    .length(1),
  statusRows: z
    .array(
      z.strictObject({
        result: z
          .enum([
            'issued',
            'reserved',
            'dispatched',
            'confirmed',
            'released',
            'needs_review',
            'reviewed',
          ])
          .nullable(),
      })
    )
    .length(1),
  acknowledgement: z.array(z.strictObject({ result: z.boolean() })).length(1),
  // Dispatched-or-released-after-dispatch attempt found by provider reference.
  referenceMatch: z.strictObject({ operationId: z.uuid() }),
};
