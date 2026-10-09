import { z } from 'zod';
import { interestPayoutSuccessEventSchema } from './piggyvest/events';
import { piggyvestPrimaryInflowRuntimeSchema } from './piggyvest-primary-inflow-runtime';
import { piggyvestStagingWalletResponseSchema } from './piggyvest-staging-wallet';

const identifier = z.string().min(1).max(512).regex(/^\S+$/);
const kobo = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const selection = z.strictObject({
  webhookCustomerId: identifier,
  sourceWalletId: identifier,
  accruedWalletId: identifier,
  destinationWalletId: identifier,
  envelopeDestinationWalletId: identifier.nullable(),
});
const financial = selection.extend({
  payoutId: identifier,
  reference: identifier,
  envelopeReference: identifier,
  batchId: identifier,
  paidAt: z.iso.datetime({ offset: true }),
  amountKobo: kobo,
  grossKobo: kobo,
  taxKobo: kobo,
  netKobo: kobo,
  currency: z.literal('NGN'),
});
const runtime = piggyvestPrimaryInflowRuntimeSchema.extend({
  environment: z.literal('production'),
  businessId: identifier,
  providerToken: z.string().min(1).max(4096),
  webhookSecret: z.string().min(1).max(4096),
  retainedWebhookSecrets: z
    .array(z.string().min(1).max(4096))
    .max(4)
    .default([]),
});

export const primaryWalletPaidInterestSchemas = {
  runtime,
  selection,
  event: interestPayoutSuccessEventSchema.extend({
    eventData: interestPayoutSuccessEventSchema.shape.eventData.extend({
      currency: z.literal('NGN').optional(),
    }),
  }),
  crosswalk: selection.extend({
    id: z.uuid(),
    integrationId: z.uuid(),
    environment: z.literal('production'),
    businessId: identifier,
    apiWalletId: identifier,
    apiCustomerId: identifier,
    providerEvidenceSha256: digest,
    policyReference: identifier,
  }),
  wallet: piggyvestStagingWalletResponseSchema.extend({
    data: piggyvestStagingWalletResponseSchema.shape.data.extend({
      api_customer_id: identifier,
      currency: z.literal('NGN'),
      status: z.literal('active'),
    }),
  }),
  proof: financial
    .extend({
      crosswalkId: z.uuid(),
      apiWalletId: identifier,
      apiCustomerId: identifier,
      businessId: identifier,
      eventId: identifier,
      bodyDigest: digest,
      observedAt: z.iso.datetime({ offset: true }),
    })
    .refine(
      (value) =>
        value.grossKobo - value.taxKobo === value.netKobo &&
        value.amountKobo === value.netKobo
    ),
  outcome: z.enum([
    'credited',
    'duplicate',
    'conflict',
    'prerequisite',
    'not_handled',
  ]),
};
