import { z } from 'zod';
import { piggyvestInterestPayoutWalletIdSchema } from './piggyvest-primary-wallet-onboarding';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

const scope = z.strictObject({
  merchantId: z.uuid(),
  customerId: z.uuid(),
  userId: z.uuid(),
  integrationId: z.uuid(),
  businessId: piggyvestProviderIdSchema,
  environment: z.enum(['staging', 'production']),
});
const recorded = scope.extend({ intentId: z.uuid(), claimToken: z.uuid() });

export const piggyvestPrimaryWalletStoreSchemas = {
  scope,
  claim: scope.extend({
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  accepted: recorded.extend({
    providerCustomerId: piggyvestProviderIdSchema,
    providerWalletId: piggyvestProviderIdSchema,
  }),
  uncertain: recorded,
  rejected: recorded,
  routingPending: recorded.extend({
    providerCustomerId: piggyvestProviderIdSchema,
    providerWalletId: piggyvestProviderIdSchema,
    interestPayoutWalletId: piggyvestInterestPayoutWalletIdSchema,
  }),
  routingRows: z
    .array(
      z.strictObject({
        result: z
          .strictObject({
            intentId: z.uuid(),
            providerCustomerId: piggyvestProviderIdSchema,
            providerWalletId: piggyvestProviderIdSchema,
            payoutWalletId: piggyvestInterestPayoutWalletIdSchema,
          })
          .nullable(),
      })
    )
    .length(1),
  claimedRows: z
    .array(
      z.strictObject({
        result: z.discriminatedUnion('status', [
          z.strictObject({
            status: z.literal('claimed'),
            intentId: z.uuid(),
            claimToken: z.uuid(),
            reclaimed: z.boolean().optional(),
          }),
          z.strictObject({ status: z.enum(['pending', 'ready', 'conflict']) }),
        ]),
      })
    )
    .length(1),
  recordedRows: z.array(z.strictObject({ result: z.boolean() })).length(1),
};
