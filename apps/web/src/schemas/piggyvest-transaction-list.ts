import { z } from 'zod';
import { piggyvestFundingAccountsSchemas } from './piggyvest-funding-accounts';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';
import { piggyvestProvisioningConfigurationSchema } from './piggyvest-provisioning-configuration';

const text = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.isWellFormed());
const cursor = text.refine(
  (value) =>
    !Array.from(value).some(
      (character) =>
        character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127
    )
);
const row = z.object({
  id: piggyvestProviderIdSchema,
  amount: z.number().int().safe(),
  type: z.enum(['credit', 'debit']),
  status: z.enum(['pending', 'successful', 'failed', 'partial']),
  category: text,
  description: z
    .string()
    .max(2048)
    .refine((value) => value.isWellFormed()),
  wallet_id: piggyvestProviderIdSchema,
  wallet_type: text,
  created_at: text,
  third_party_reference: text.nullable().optional(),
  peer_reference_id: text.nullable().optional(),
  batch_transaction_id: text.nullable().optional(),
  batch_total_split: z.never().optional(),
  batch_successful_split: z.never().optional(),
  failed_split: z.never().optional(),
});

export const piggyvestTransactionListSchemas = {
  configuration: piggyvestProvisioningConfigurationSchema.refine(
    (config) =>
      config.expectedBusinessId.trim().length > 0 &&
      config.expectedBusinessId === config.expectedBusinessId.trim()
  ),
  identity: piggyvestFundingAccountsSchemas.trustedIdentity,
  query: z.strictObject({
    limit: z.number().int().min(1).max(100).default(20),
    cursor: cursor.optional(),
  }),
  response: z.object({
    status: z.literal(true),
    data: z.object({
      edges: z.array(row).max(100),
      batchInfo: z.never().optional(),
      pageInfo: z
        .object({
          hasNextPage: z.boolean(),
          endCursor: cursor.nullable(),
          previousCursor: cursor.nullable(),
        })
        .refine(
          (page) =>
            (!page.hasNextPage || page.endCursor !== null) &&
            (page.endCursor === null || page.endCursor !== page.previousCursor)
        ),
    }),
  }),
};

export type PiggyvestTransactionListObservation = Pick<
  z.infer<typeof piggyvestTransactionListSchemas.response>['data'],
  'edges' | 'pageInfo'
> & {
  monetaryUnits: 'kobo';
  spendable: false;
  financialEffects: 'UNKNOWN';
};
