import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';
import { piggyvestStagingConfigurationSchema } from './piggyvest-staging-configuration';

export const piggyvestProvisioningConfigurationSchema =
  piggyvestStagingConfigurationSchema
    .extend({
      expectedCurrency: z.literal('NGN').default('NGN'),
      expectedBusinessId: piggyvestProviderIdSchema,
      environment: z.literal('staging'),
      integrationId: z.uuid(),
      expectedMerchantId: z.uuid(),
      expectedProjectId: z.string().trim().min(1).max(128),
      actualProjectId: z.string().trim().min(1).max(128),
      allowlistedCustomerIds: z.array(z.uuid()).min(1).max(20),
      provisioningApproved: z.literal(true),
      syntheticIdentityApproved: z.literal(true),
      defaultInterestRoutingVerified: z.boolean().default(false),
      defaultInterestRoutingAttestation: z
        .strictObject({
          attestationId: z.string().trim().min(1).max(128),
          businessId: piggyvestProviderIdSchema,
          globalSplit: z.literal('9%/3%'),
        })
        .optional(),
      fingerprintKey: z.string().min(32).max(512),
      verifiedInterestPayoutWalletId: piggyvestProviderIdSchema.optional(),
    })
    .refine((value) => value.actualProjectId === value.expectedProjectId);
