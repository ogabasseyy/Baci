import { z } from 'zod';
import { primarySavingsProvisioningSchemas } from './primary-savings-provisioning';

export const primarySavingsProvisioningPaginationSchemas = {
  input: z.strictObject({
    customerId: primarySavingsProvisioningSchemas.providerId,
    walletName: z.string().min(1).max(200),
  }),
  page: z.object({
    paginatedPayload: z.object({
      edges: primarySavingsProvisioningSchemas.wallets,
      pageInfo: z
        .object({
          hasNextPage: z.boolean(),
          endCursor: z.string().min(1).max(512).nullish(),
        })
        .superRefine((value, context) => {
          if (value.hasNextPage && !value.endCursor)
            context.addIssue({
              code: 'custom',
              path: ['endCursor'],
              message: 'Continuation cursor required',
            });
        }),
    }),
  }),
};
