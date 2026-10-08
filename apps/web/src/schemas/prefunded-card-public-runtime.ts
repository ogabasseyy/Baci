import { z } from 'zod';
import { piggyvestCustomerPolicyContextSchemas } from './piggyvest-customer-policy-context';
import { prefundedCardKnownDeadlineSchema } from './prefunded-card-known-deadline';
import { prefundedCardPostgresExecutorSchema } from './prefunded-card-postgres-executor';

const context = z
  .strictObject({
    ...piggyvestCustomerPolicyContextSchemas.configuration.shape,
    transport: z.literal('tls'),
  })
  .refine(
    (value) =>
      value.expectedProjectId === value.actualProjectId &&
      value.allowlistedMerchantIds.includes(value.merchantId)
  );

export const prefundedCardPublicRuntimeSchemas = {
  context,
  configuration: z
    .strictObject({
      deployment: z.literal('staging'),
      expiresAt: prefundedCardKnownDeadlineSchema,
      publicOrigin: z.enum([
        'https://staging.ogabassey.com',
        'https://staging-auth.ogabassey.com',
      ]),
      authOrigin: z.literal('https://staging-auth.ogabassey.com'),
      context,
      database: prefundedCardPostgresExecutorSchema,
    })
    .superRefine((value, validation) => {
      const database = value.database;
      if (
        database.profile !== 'customer' ||
        database.transport !== 'tls' ||
        database.expectedSystemId !== '7685292944002592802' ||
        database.expectedProjectId !== value.context.expectedProjectId ||
        database.actualProjectId !== value.context.actualProjectId
      )
        validation.addIssue({
          code: 'custom',
          message: 'Invalid public card runtime',
        });
    }),
};
