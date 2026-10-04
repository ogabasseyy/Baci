import { z } from 'zod';
import { containsAsciiControl } from '@/lib/contains-ascii-control';
import { prefundedCardWorkerSchemas } from './prefunded-card-worker';

const identifier = z
  .string()
  .min(1)
  .max(512)
  .regex(/^\S+$/)
  .refine((value) => !containsAsciiControl(value))
  .refine((value) => new TextEncoder().encode(value).byteLength <= 512);
const eventType = z.enum([
  'bank-transfer.inflow.success',
  'wallet-transfer.outflow.success',
]);
const optionalIdentifier = identifier
  .nullish()
  .transform((value) => value ?? undefined);
const hints = z
  .strictObject({
    eventType,
    envelopeWalletId: identifier,
    envelopeCustomerId: identifier,
    destinationWalletId: identifier.nullable(),
    innerCustomerId: identifier.nullable(),
    sourceWalletId: identifier.nullable(),
    declaredDestinationWalletId: identifier.nullable(),
    references: z.array(identifier).min(1).max(16),
  })
  .superRefine((value, context) => {
    if (
      value.eventType === 'bank-transfer.inflow.success' &&
      (value.destinationWalletId === null || value.innerCustomerId === null)
    )
      context.addIssue({ code: 'custom', message: 'Enrollment unavailable' });
  });

export const prefundedCardReplayEnrollmentSchemas = {
  configuration: z.strictObject({
    scope: prefundedCardWorkerSchemas.scope.omit({ batchSize: true }),
    databaseName: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  }),
  input: z.strictObject({
    receiptId: identifier,
    payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
    eventId: identifier,
    eventType,
    providerCustomerId: identifier,
    rawPayload: z.unknown(),
  }),
  envelope: z.object({
    eventId: identifier,
    eventType,
    eventCategory: z.enum([
      'bank-transfer',
      'inflow_transaction',
      'wallet-transfer',
    ]),
    customer_id: identifier,
    pvb_wallet: identifier,
    pvb_reference: optionalIdentifier,
    pvb_third_party_reference: optionalIdentifier,
    pvb_destination_wallet: optionalIdentifier,
    eventData: z.object({
      customer_id: optionalIdentifier,
      destination_wallet_id: optionalIdentifier,
      source_wallet_id: z.union([identifier, z.literal('')]).nullish(),
      id: optionalIdentifier,
      transaction_id: optionalIdentifier,
      reference: optionalIdentifier,
      third_party_reference: optionalIdentifier,
      internal_reference: optionalIdentifier,
      initiator_reference: optionalIdentifier,
      session_id: optionalIdentifier,
    }),
  }),
  hints,
  serializedHints: z
    .string()
    .max(16_384)
    .refine((value) => {
      try {
        return (
          new TextEncoder().encode(value).byteLength <= 16_384 &&
          hints.safeParse(JSON.parse(value)).success
        );
      } catch {
        return false;
      }
    }),
  rows: z
    .array(
      z.strictObject({ result: z.enum(['enrolled', 'legacy', 'deferred']) })
    )
    .length(1),
};
