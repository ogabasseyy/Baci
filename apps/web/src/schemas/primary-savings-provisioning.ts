import { z } from 'zod';
import { piggyvestPrimaryWalletRuntimeSchema } from './piggyvest-primary-wallet-runtime';
import { piggyvestPrimaryWalletSnapshotSchemas } from './piggyvest-primary-wallet-snapshot';
import { piggyvestPrimaryWalletStoreSchemas } from './piggyvest-primary-wallet-store';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

const selection = z.strictObject({ merchantId: z.uuid(), goalId: z.uuid() });
const response = z
  .strictObject({
    goalId: z.uuid(),
    status: z.enum([
      'pending',
      'ready',
      'conflict',
      'not_found',
      'unavailable',
    ]),
    interestAccepted: z.boolean().nullable(),
    interestEnrollment: z.enum(['requested', 'not_requested', 'unknown']),
    accounts: z
      .array(
        z.strictObject({
          accountNumber: z.string().regex(/^\d{10}$/),
          accountName: z.string().min(1).max(200),
          bankName: z.string().min(1).max(200),
        })
      )
      .max(20),
  })
  .superRefine((value, context) => {
    if ((value.status === 'ready') !== value.accounts.length > 0)
      context.addIssue({
        code: 'custom',
        path: ['accounts'],
        message: 'Only ready wallets expose verified accounts',
      });
    if (
      value.interestEnrollment !==
      (value.interestAccepted === null
        ? 'unknown'
        : value.interestAccepted
          ? 'requested'
          : 'not_requested')
    )
      context.addIssue({
        code: 'custom',
        path: ['interestEnrollment'],
        message: 'Consent projection mismatch',
      });
  });
const record = z.strictObject({
  status: z.enum(['claimed', 'pending', 'ready', 'conflict']),
  claimToken: z.uuid().nullable(),
  providerCustomerId: piggyvestProviderIdSchema,
  primaryWalletId: piggyvestProviderIdSchema,
  walletName: z.string().min(1).max(200),
  providerWalletId: piggyvestProviderIdSchema.nullable(),
  interestAccepted: z.boolean(),
});

export const primarySavingsProvisioningSchemas = {
  response,
  request: selection.extend({
    consent: z.literal(true),
    interestAccepted: z.boolean(),
  }),
  interestAccepted: z.boolean(),
  selection,
  scope: piggyvestPrimaryWalletStoreSchemas.scope,
  goalId: z.uuid(),
  claimToken: z.uuid(),
  providerId: piggyvestProviderIdSchema,
  rows: z.array(z.strictObject({ result: record.nullable() })).length(1),
  acknowledgement: piggyvestPrimaryWalletStoreSchemas.recordedRows,
  created: z.object({ id: piggyvestProviderIdSchema }),
  wallets: z
    .array(
      z.object({
        id: piggyvestProviderIdSchema,
        name: z.string(),
        status: z.string(),
      })
    )
    .max(100),
  wallet: piggyvestPrimaryWalletSnapshotSchemas.wallet.extend({
    name: z.string().min(1).max(200),
    type: z.literal('api'),
  }),
  accounts: piggyvestPrimaryWalletSnapshotSchemas.accounts.min(1),
  proof: z.strictObject({
    providerCustomerId: piggyvestProviderIdSchema,
    providerWalletId: piggyvestProviderIdSchema,
    walletName: z.string().min(1).max(200),
    businessId: piggyvestProviderIdSchema,
    currency: z.literal('NGN'),
    status: z.literal('active'),
    type: z.literal('api'),
    hasFundingAccount: z.literal(true),
    interestAccepted: z.boolean(),
  }),
  runtime: piggyvestPrimaryWalletRuntimeSchema.extend({
    database: piggyvestPrimaryWalletRuntimeSchema.shape.database.extend({
      login: z.literal('baci_piggyvest_primary_goal_provisioner'),
    }),
  }),
};
