import { z } from 'zod';
import { piggyvestStagingWalletResponseSchema } from './piggyvest-staging-wallet';

const identifier = z
  .string()
  .min(1)
  .max(512)
  .regex(/^\S+$/)
  .refine((value) =>
    Array.from(value).every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })
  );
const uuid = z.uuid();
const amount = z.number().int().positive().safe();
const crosswalk = z.strictObject({
  authority: z.enum([
    'provider_authenticated_crosswalk',
    'owner_reviewed_provisioning_identity',
  ]),
  integrationId: uuid,
  merchantId: uuid,
  customerId: uuid,
  businessId: identifier,
  publicWalletId: identifier,
  apiCustomerId: identifier,
  webhookCustomerId: identifier,
  evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime(),
});
const ownership = z.strictObject({
  observedAt: z.iso.datetime(),
  binding: z.strictObject({
    integrationId: uuid,
    merchantId: uuid,
    customerId: uuid,
    goalId: uuid,
    systemIdentifier: z.string().regex(/^[0-9]{1,20}$/),
    providerWalletId: identifier,
    providerCustomerId: identifier,
    enabled: z.literal(true),
  }),
  crosswalk,
});
const normalized = z.object({
  status: z.literal(true),
  data: z
    .object({
      status: z.literal('success'),
      id: identifier,
      reference: identifier,
      amount,
      currency: z.literal('NGN'),
      business_id: identifier,
      source_wallet: identifier,
      destination_wallet: identifier,
      destination_customer_id: identifier,
      fee: z.literal(0).optional(),
      third_party_reference: identifier.optional(),
      internal_reference: identifier.optional(),
    })
    .refine(
      (data) =>
        (data.third_party_reference === undefined ||
          data.third_party_reference === data.reference) &&
        (data.internal_reference === undefined ||
          data.internal_reference === data.id)
    ),
});
const rich = z.object({
  status: z.literal(true),
  data: z
    .object({
      status: z.literal('successful'),
      id: identifier,
      internal_reference: identifier,
      reference: identifier,
      third_party_reference: identifier,
      amount,
      fee: z.literal(0),
      customer_id: identifier,
      source_wallet: identifier,
      destination_wallet: identifier,
      business_id: identifier.optional(),
      currency: identifier.optional(),
      destination_customer_id: identifier.optional(),
    })
    .refine(
      (data) =>
        data.id === data.internal_reference &&
        data.source_wallet !== data.destination_wallet
    ),
});

// Terminal failure twin of the rich envelope: a successfully queried
// transfer that the provider reports as failed. Field bindings mirror
// success exactly so failed evidence authenticates against the same
// stored reservation before any hold is released.
const richFailed = z.object({
  status: z.literal(true),
  data: z
    .object({
      status: z.literal('failed'),
      id: identifier,
      internal_reference: identifier,
      reference: identifier,
      third_party_reference: identifier,
      amount,
      fee: z.literal(0),
      customer_id: identifier,
      source_wallet: identifier,
      destination_wallet: identifier,
      business_id: identifier.optional(),
      currency: identifier.optional(),
      destination_customer_id: identifier.optional(),
    })
    .refine(
      (data) =>
        data.id === data.internal_reference &&
        data.source_wallet !== data.destination_wallet
    ),
});

export const prefundedCardTransferVerificationSchemas = {
  identifier,
  normalized,
  rich,
  richFailed,
  ownership,
  runtimeOwnership: ownership.extend({
    crosswalk: crosswalk.extend({
      authority: z.literal('provider_authenticated_crosswalk'),
    }),
  }),
  reviewedApproval: z.strictObject({
    identitySha256: z.string().regex(/^[a-f0-9]{64}$/),
    transactionAuditSha256: z.string().regex(/^[a-f0-9]{64}$/),
    reviewedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  }),
  corroboration: z.strictObject({
    retrievedAt: z.iso.datetime(),
    sourceWallet: piggyvestStagingWalletResponseSchema,
    destinationWallet: piggyvestStagingWalletResponseSchema,
    ownership,
  }),
};
