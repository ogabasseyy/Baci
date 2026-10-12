import { z } from 'zod';
import { piggyvestFundingAccountsSchemas } from './piggyvest-funding-accounts';
import { piggyvestFundingDisplaySchema } from './piggyvest-funding-display';
import { piggyvestProvisioningConfigurationSchema } from './piggyvest-provisioning-configuration';

export const piggyvestCustomerFundingViewSchemas = {
  configuration: piggyvestProvisioningConfigurationSchema
    .safeExtend({ fundingDisplayEnabled: z.literal(true) })
    .refine(
      (configuration) =>
        configuration.expectedBusinessId.trim().length > 0 &&
        configuration.expectedBusinessId ===
          configuration.expectedBusinessId.trim()
    ),
  identity: piggyvestFundingAccountsSchemas.trustedIdentity,
  view: piggyvestFundingDisplaySchema,
};

export type PiggyvestCustomerFundingView = z.infer<
  typeof piggyvestCustomerFundingViewSchemas.view
>;
