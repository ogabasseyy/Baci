import { z } from 'zod';
import { piggyvestFundingAccountsSchemas } from './piggyvest-funding-accounts';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';
import { piggyvestProvisioningConfigurationSchema } from './piggyvest-provisioning-configuration';

const boundedText = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.isWellFormed());
const interestType = z.enum(['original', 'differential']);
const edge = z.object({
  id: piggyvestProviderIdSchema,
  business_id: piggyvestProviderIdSchema,
  wallet_id: piggyvestProviderIdSchema,
  wallet_name: boundedText,
  amount: z.number().finite(),
  balance: z.number().finite(),
  percentage: z.number().finite(),
  interest_date: boundedText,
  interest_date_timestamp: boundedText,
  interest_type: interestType,
  differential_wallet_id: piggyvestProviderIdSchema.nullable(),
  differential_wallet_name: boundedText.nullable(),
  created_at: boundedText,
  updated_at: boundedText,
});

export const piggyvestAccruedInterestSchemas = {
  configuration: piggyvestProvisioningConfigurationSchema.refine(
    (configuration) =>
      configuration.expectedBusinessId.trim().length > 0 &&
      configuration.expectedBusinessId ===
        configuration.expectedBusinessId.trim()
  ),
  trustedIdentity: piggyvestFundingAccountsSchemas.trustedIdentity,
  query: z
    .strictObject({
      start_date: z.iso.date(),
      end_date: z.iso.date(),
      limit: z.number().int().min(1).max(100).default(31),
      cursor: boundedText.optional(),
      interest_type: interestType.default('original'),
    })
    .refine((query) => query.start_date <= query.end_date),
  response: z.object({
    status: z.literal(true),
    data: z.object({
      paginatedPayload: z.object({
        edges: z.array(edge).max(100),
        pageInfo: z
          .object({
            hasNextPage: z.boolean(),
            endCursor: boundedText.nullable(),
            previousCursor: boundedText.nullable(),
          })
          .refine(
            (page) =>
              (!page.hasNextPage || page.endCursor !== null) &&
              (page.endCursor === null ||
                page.endCursor !== page.previousCursor)
          ),
      }),
    }),
  }),
};

export type PiggyvestAccruedInterestQuery = z.input<
  typeof piggyvestAccruedInterestSchemas.query
>;
export type PiggyvestAccruedInterestObservation = z.infer<
  typeof piggyvestAccruedInterestSchemas.response
>['data']['paginatedPayload'] & {
  monetaryUnits: 'unconfirmed';
  spendable: false;
};
