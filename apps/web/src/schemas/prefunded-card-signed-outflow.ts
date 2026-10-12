import { z } from 'zod';
import { containsAsciiControl } from '@/lib/contains-ascii-control';

const identifier = z
  .string()
  .min(1)
  .max(512)
  .regex(/^\S+$/)
  .refine((value) => !containsAsciiControl(value));
const amount = z.number().int().positive().safe();
const signed = z
  .object({
    eventId: identifier,
    eventType: z.literal('wallet-transfer.outflow.success'),
    eventCategory: z.literal('wallet_transfer'),
    customer_id: z.uuid(),
    pvb_reference: identifier.optional(),
    pvb_wallet: identifier,
    pvb_destination_wallet: identifier,
    pvb_third_party_reference: identifier,
    eventData: z.object({
      id: z.uuid(),
      transaction_id: z.uuid(),
      customer_id: z.uuid().optional(),
      source_wallet: identifier,
      destination_wallet: identifier,
      amount,
      currency: z.literal('NGN'),
      fee: z.union([z.literal(0), z.null()]),
      status: z.literal('COMPLETED'),
      reference: identifier,
      internal_reference: identifier,
      third_party_reference: identifier,
      initiator_reference: identifier,
    }),
  })
  .refine(
    (value) =>
      value.pvb_wallet !== value.pvb_destination_wallet &&
      value.eventData.source_wallet !== value.eventData.destination_wallet &&
      value.eventData.reference === value.eventData.internal_reference &&
      value.eventData.third_party_reference ===
        value.eventData.initiator_reference &&
      (value.eventData.customer_id === undefined ||
        value.eventData.customer_id === value.customer_id)
  );
const transaction = z.object({
  status: z.literal(true),
  data: z
    .object({
      id: identifier,
      internal_reference: identifier,
      reference: identifier,
      third_party_reference: identifier,
      customer_id: identifier,
      source_wallet: identifier,
      destination_wallet: identifier,
      status: z.literal('successful'),
      amount,
      fee: z.literal(0),
      currency: z.literal('NGN').optional(),
      business_id: identifier.optional(),
      destination_customer_id: identifier.optional(),
    })
    .refine((value) => value.id === value.internal_reference),
});
const wallet = z.object({
  status: z.literal(true),
  data: z.object({
    id: identifier,
    faas_wallet_identifier: identifier,
    api_customer_id: identifier.nullish(),
    business_id: identifier,
    currency: z.literal('NGN'),
    status: z.literal('active'),
    balance: z.number().finite(),
  }),
});
const wallets = z.object({
  status: z.literal(true),
  data: z.object({
    paginatedPayload: z.object({
      edges: z
        .array(
          z.object({
            id: identifier,
            faas_wallet_identifier: identifier,
            api_customer_id: identifier,
            business_id: identifier,
            currency: z.literal('NGN'),
          })
        )
        .max(100),
    }),
  }),
});

export const prefundedCardSignedOutflowSchemas = {
  signed,
  transaction,
  wallet,
  wallets,
};
