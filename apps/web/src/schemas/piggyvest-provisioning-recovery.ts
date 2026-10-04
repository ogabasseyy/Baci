import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';
import { piggyvestProvisioningStoreSchemas } from './piggyvest-provisioning-store';
import { piggyvestStagingConfigurationSchema } from './piggyvest-staging-configuration';

const scope = z.strictObject({
  intentId: z.uuid(),
  customerId: z.uuid(),
  goalId: z.uuid().nullable(),
});
const observation = z.strictObject({
  id: piggyvestProviderIdSchema,
  business_id: piggyvestProviderIdSchema,
  currency: z.string().min(1).max(16),
  status: z.string().min(1).max(64),
});
const outcome = z.enum([
  'ownership_unverified',
  'wallet_mismatch',
  'wallet_not_active',
  'lookup_unavailable',
  'missing_reference',
  'stale',
]);

export const piggyvestProvisioningRecoverySchemas = {
  customerId: z.uuid(),
  customerMapping: z
    .array(
      z.strictObject({
        outcome: z.enum([
          'none',
          'mapped',
          'conflict',
          'disabled',
          'business_mismatch',
        ]),
        provider_customer_id: piggyvestProviderIdSchema.nullable(),
      })
    )
    .length(1)
    .refine(
      ([row]) =>
        (row.outcome === 'mapped') === (row.provider_customer_id !== null)
    ),
  customerAcknowledgement: z.strictObject({
    intentId: z.uuid(),
    claimToken: z.uuid(),
    providerCustomerId: piggyvestProviderIdSchema,
    providerWalletId: piggyvestProviderIdSchema,
    newCustomer: z.literal(true),
  }),
  customerRecorded: z
    .array(
      z.strictObject({
        outcome: z.enum(['awaiting_confirmation', 'unknown', 'stale']),
      })
    )
    .length(1),
  configuration: piggyvestProvisioningStoreSchemas.configuration,
  clientConfiguration: z
    .strictObject({
      storage: piggyvestProvisioningStoreSchemas.configuration,
      wallet: piggyvestStagingConfigurationSchema,
    })
    .refine(
      (config) =>
        config.storage.expectedBusinessId ===
          config.wallet.expectedBusinessId &&
        config.wallet.expectedCurrency === 'NGN'
    ),
  scope,
  observation,
  response: z.object({ status: z.literal(true), data: observation.strip() }),
  rows: z
    .array(
      z
        .strictObject({
          intent_id: z.uuid(),
          merchant_id: z.uuid(),
          customer_id: z.uuid(),
          goal_id: z.uuid().nullable(),
          operation: z.enum(['create_customer', 'create_plan_wallet']),
          status: z.enum(['unknown', 'awaiting_confirmation']),
          provider_customer_id: piggyvestProviderIdSchema.nullable(),
          provider_wallet_id: piggyvestProviderIdSchema.nullable(),
          dispatch_provider_customer_id: piggyvestProviderIdSchema.nullable(),
        })
        .refine(
          (row) =>
            (row.operation === 'create_customer') === (row.goal_id === null)
        )
    )
    .max(1),
  recorded: z.array(z.strictObject({ outcome })).length(1),
  verification: z
    .array(
      z.strictObject({
        verification_token: z.uuid(),
        provider_wallet_id: piggyvestProviderIdSchema,
        completed: z.boolean(),
      })
    )
    .max(1),
  token: z.uuid(),
  confirmed: z
    .array(
      z.strictObject({
        outcome: z.enum([
          'completed',
          'stale',
          'wallet_mismatch',
          'wallet_not_active',
          'ownership_unverified',
          'mapping_conflict',
        ]),
      })
    )
    .length(1),
};
