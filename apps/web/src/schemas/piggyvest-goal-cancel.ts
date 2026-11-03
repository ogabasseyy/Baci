import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

const proof = z.string().regex(/^[0-9a-f]{64}$/);
const amountKobo = z.int().positive().max(9999999999);

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
          .enum(['issued', 'reserved', 'dispatched', 'confirmed', 'released'])
          .nullable(),
      })
    )
    .length(1),
  acknowledgement: z.array(z.strictObject({ result: z.boolean() })).length(1),
};
