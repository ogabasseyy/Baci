import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

const operation = z.enum(['create_customer', 'create_plan_wallet']);
const status = z.enum([
  'pending',
  'dispatched',
  'unknown',
  'awaiting_confirmation',
]);
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const identity = z
  .strictObject({
    kind: operation,
    merchantId: z.uuid(),
    customerId: z.uuid(),
    goalId: z.uuid().nullable(),
    providerCustomerId: piggyvestProviderIdSchema.nullable(),
    requestFingerprint: fingerprint,
  })
  .refine(
    (input) =>
      (input.kind === 'create_customer') === (input.goalId === null) &&
      (input.kind === 'create_customer') === (input.providerCustomerId === null)
  );

export const piggyvestProvisioningStoreSchemas = {
  configuration: z.strictObject({
    environment: z.literal('staging'),
    integrationId: z.uuid(),
    expectedMerchantId: z.uuid(),
    expectedBusinessId: piggyvestProviderIdSchema,
  }),
  identity,
  intentId: z.uuid(),
  prepared: z
    .array(
      z.strictObject({
        intent_id: z.uuid(),
        outcome: z.enum(['accepted', 'duplicate', 'conflict']),
        status,
      })
    )
    .length(1),
  claimed: z
    .array(
      z.strictObject({
        intent_id: z.uuid(),
        operation,
        merchant_id: z.uuid(),
        customer_id: z.uuid(),
        goal_id: z.uuid().nullable(),
        request_fingerprint: fingerprint,
        claim_token: z.uuid(),
        attempts: z.literal(1),
        lease_expires_at_ms: z.number().finite().positive(),
      })
    )
    .max(1),
  record: z
    .strictObject({
      intentId: z.uuid(),
      claimToken: z.uuid(),
      resultCode: z.enum(['accepted', 'ambiguous']),
      newCustomer: z.literal(true).optional(),
      providerCustomerId: piggyvestProviderIdSchema.nullable(),
      providerWalletId: piggyvestProviderIdSchema.nullable(),
    })
    .refine(
      (input) =>
        (input.resultCode !== 'accepted' || input.providerWalletId !== null) &&
        (!input.newCustomer ||
          (input.resultCode === 'accepted' &&
            input.providerCustomerId !== null))
    ),
  recorded: z
    .array(
      z.strictObject({
        outcome: z.enum(['awaiting_confirmation', 'unknown', 'stale']),
      })
    )
    .length(1),
};
