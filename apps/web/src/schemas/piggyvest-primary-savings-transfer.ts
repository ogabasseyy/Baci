import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

export const piggyvestPrimarySavingsTransferSchemas = {
  recoveryRequest: z.strictObject({ merchantId: z.uuid(), goalId: z.uuid() }),
  recoveryRows: z
    .array(
      z.strictObject({
        result: z
          .strictObject({
            operationId: z.uuid(),
            goalId: z.uuid(),
            amountKobo: z.int().positive().max(9999999999),
            state: z.enum(['reserved', 'dispatched']),
          })
          .nullable(),
      })
    )
    .length(1),
  statusRequest: z.strictObject({
    merchantId: z.uuid(),
    operationId: z.uuid(),
  }),
  statusRows: z
    .array(
      z.strictObject({
        result: z
          .enum(['reserved', 'dispatched', 'confirmed', 'cancelled'])
          .nullable(),
      })
    )
    .length(1),
  httpRequest: z.strictObject({
    merchantId: z.uuid(),
    goalId: z.uuid(),
    operationId: z.uuid(),
    amountKobo: z.int().positive().max(9999999999),
    // Single-use PIN proof from the goal PIN verify route (64 hex chars).
    // Optional at parse time: a merchant without PIN checking funds without
    // one. Whether a proof is required is decided by the database at
    // reservation time, never by the caller.
    pinProof: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  }),
  // The empty string means "no proof presented"; the database refuses it when
  // the merchant has PIN checking on and accepts it when the merchant has not.
  pinProof: z.union([z.literal(''), z.string().regex(/^[0-9a-f]{64}$/)]),
  request: z.strictObject({
    goalId: z.uuid(),
    operationId: z.uuid(),
    amountKobo: z.int().positive().max(9999999999),
  }),
  reserved: z.strictObject({
    operationId: z.uuid(),
    goalId: z.uuid(),
    amountKobo: z.int().positive().max(9999999999),
    sourceWalletId: piggyvestProviderIdSchema,
    destinationWalletId: piggyvestProviderIdSchema,
    reference: z.string().min(1).max(200),
    businessId: piggyvestProviderIdSchema,
    providerCustomerId: piggyvestProviderIdSchema,
  }),
  wallet: z.object({
    id: piggyvestProviderIdSchema,
    // Owning provider customer, required for evidence binding: the
    // transfer must prove the source wallet belongs to the reserved
    // provider customer before dispatching.
    api_customer_id: piggyvestProviderIdSchema,
    business_id: piggyvestProviderIdSchema,
    currency: z.literal('NGN'),
    status: z.literal('active'),
    balance: z.int().nonnegative(),
  }),
  acknowledgement: z.array(z.strictObject({ result: z.boolean() })).length(1),
  adoptionRows: z
    .array(
      z.strictObject({
        result: z.discriminatedUnion('status', [
          z.strictObject({
            status: z.enum(['adopted', 'reclaimed']),
            reservation: z.unknown(),
          }),
          z.strictObject({ status: z.literal('existing') }),
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
              'insufficient',
              'conflict',
            ]),
          }),
        ]),
      })
    )
    .length(1),
};
