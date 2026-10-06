import { z } from 'zod';
import { prefundedCardClaimedRequestSchema } from './prefunded-card-claimed-request';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const eventId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const transactionId = z
  .string()
  .regex(/^[1-9][0-9]{0,19}$/)
  .refine(
    (value) =>
      /^[1-9][0-9]{0,19}$/.test(value) &&
      BigInt(value) <= 18_446_744_073_709_551_615n
  );
const command = z.strictObject({
  operationId: uuid,
  integrationId: uuid,
  merchantId: uuid,
  customerId: uuid,
  goalId: uuid,
  treasuryBindingId: uuid,
  savedMethodId: uuid,
  eventId,
  collectionReference: eventId,
  collectionTransactionId: transactionId,
  collectionAmountKobo: z.number().int().positive().safe(),
  currency: z.literal('NGN'),
  providerStatus: z.literal('reversed'),
  domain: z.literal('test'),
});
const receipt = z.strictObject({
  operationId: uuid,
  eventId,
  outcome: z.enum(['recorded', 'duplicate']),
  obligation: z.literal('review_required'),
  exposure: z.enum([
    'transfer_not_started',
    'transfer_in_flight',
    'transfer_completed',
    'transfer_failed',
  ]),
});
const context = z.strictObject({
  request: prefundedCardClaimedRequestSchema,
  collectionTransactionId: transactionId.nullable(),
});

export const prefundedCardReversalSchemas = {
  uuid,
  eventId,
  command,
  receipt,
  contextRows: z.array(z.strictObject({ result: context })).length(1),
  receiptRows: z.array(z.strictObject({ result: receipt })).length(1),
  providerResponse: z.object({
    status: z.literal(true),
    data: z.object({
      id: z.union([
        transactionId,
        z.number().int().positive().safe().transform(String),
      ]),
      status: z.literal('reversed'),
      domain: z.literal('test'),
      reference: eventId,
      amount: z.number().int().positive().safe(),
      currency: z.literal('NGN'),
      customer: z.object({
        customer_code: z.string().min(1).max(512),
        email: z.email(),
      }),
      authorization: z.object({
        authorization_code: z.string().min(1).max(512),
      }),
    }),
  }),
};
