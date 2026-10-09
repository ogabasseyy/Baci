import { z } from 'zod';
import { primaryWalletCardCheckoutRuntimeSchema } from './primary-wallet-card-checkout-runtime';

const identifier = z.string().min(1).max(512).regex(/^\S+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const context = z
  .strictObject({
    operationId: z.uuid(),
    integrationId: z.uuid(),
    merchantId: z.uuid(),
    customerId: z.uuid(),
    environment: z.enum(['staging', 'production']),
    businessId: identifier,
    amountKobo: z.number().int().positive().max(9999999999),
    sourceWalletId: identifier,
    destinationWalletId: identifier,
    destinationCustomerId: identifier,
    reference: z.string().regex(/^pvb-primary-transfer-[0-9a-f-]{36}$/),
  })
  .refine(
    (value) =>
      value.sourceWalletId !== value.destinationWalletId &&
      value.reference === `pvb-primary-transfer-${value.operationId}`
  );
const database = primaryWalletCardCheckoutRuntimeSchema.shape.authorizer.omit({
  login: true,
});
const command = z.strictObject({
  operationId: z.uuid(),
  sourceWalletId: identifier,
  destinationWalletId: identifier,
  amountKobo: context.shape.amountKobo,
  currency: z.literal('NGN'),
  reference: context.shape.reference,
});

export const primaryWalletCardCustodySchemas = {
  context,
  command,
  crosswalk: z.strictObject({
    authority: z.literal('provider_authenticated_crosswalk'),
    contractId: identifier,
    evidenceIssuer: identifier,
    treasuryWebhookCustomerId: identifier,
    transactionCustomerId: identifier,
    integrationId: z.uuid(),
    merchantId: z.uuid(),
    customerId: z.uuid(),
    businessId: identifier,
    publicWalletId: identifier,
    apiCustomerId: identifier,
    webhookCustomerId: identifier,
    canonicalTransactionId: identifier,
    transactionAliases: z.array(identifier).min(1).max(8),
    bankInflowTransactionId: identifier,
    aliasesComplete: z.literal(true),
    evidenceSha256: hash,
    observedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  }),
  proof: context.safeExtend({
    providerTransactionId: identifier,
    transactionAliases: z.array(identifier).min(1).max(8),
    eventId: identifier,
    inboxToken: z.uuid(),
    bodyDigest: hash,
    crosswalkDigest: hash,
    observedAt: z.iso.datetime({ offset: true }),
    feeKobo: z.literal(0),
    currency: z.literal('NGN'),
  }),
  claim: z.discriminatedUnion('outcome', [
    z.strictObject({ outcome: z.literal('existing') }),
    z.strictObject({ outcome: z.literal('claimed'), token: z.uuid(), command }),
    z.strictObject({
      outcome: z.literal('reclaimed'),
      token: z.uuid(),
      command,
    }),
  ]),
  outcome: z.enum(['completed', 'duplicate', 'conflict']),
  runtime: z.strictObject({
    integrationId: z.uuid(),
    merchantId: z.uuid(),
    businessId: identifier,
    crosswalkAuthority: z.strictObject({
      contractId: identifier,
      evidenceIssuer: identifier,
      treasuryWebhookCustomerId: identifier,
      transactionCustomerId: identifier,
    }),
    environment: context.shape.environment,
    expiresAt: z.iso.datetime({ offset: true }),
    apiToken: z.string().min(1).max(4096),
    webhookSecret: z.string().min(1).max(4096),
    transfer: database
      .extend({
        login: z.literal('baci_primary_card_transfer'),
      })
      .optional(),
    custody: database.extend({ login: z.literal('baci_primary_card_custody') }),
  }),
};
