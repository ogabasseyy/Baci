import { z } from 'zod';
import { piggyvestPrimaryWalletRuntimeSchema } from './piggyvest-primary-wallet-runtime';

const identifier = z.string().min(1).max(512);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const signature = z.string().regex(/^[a-f0-9]{128}$/);
const rawHex = z
  .string()
  .min(2)
  .max(131072)
  .regex(/^(?:[a-f0-9]{2})+$/);
const scope = z.strictObject({
  merchantId: z.uuid(),
  businessId: identifier,
  expiresAt: z.iso.datetime({ offset: true }),
});
const claim = z.strictObject({
  eventId: identifier,
  token: z.uuid(),
  rawHex,
  signature,
  bodyDigest: digest,
  attempts: z.int().min(1).max(50),
});
export const primaryWalletBankInboxSchemas = {
  runtime: z.strictObject({
    integrationId: z.uuid(),
    environment: z.enum(['staging', 'production']),
    scope,
    webhookSecret: z.string().min(1).max(4096),
    retainedWebhookSecrets: z
      .array(z.string().min(1).max(4096))
      .max(3)
      .default([]),
    database: piggyvestPrimaryWalletRuntimeSchema.shape.database.extend({
      login: z.enum(['baci_primary_bank_intake', 'baci_primary_bank_worker']),
    }),
  }),
  scope,
  enqueue: z.strictObject({ rawHex, signature }),
  intake: z.enum(['accepted', 'duplicate', 'conflict', 'not_handled']),
  batch: z.strictObject({ batchSize: z.int().min(1).max(10) }),
  claims: z.array(claim).max(10),
  process: z.strictObject({
    eventId: identifier,
    token: z.uuid(),
    receipt: z.record(z.string(), z.unknown()),
  }),
  result: z.enum(['credited', 'duplicate', 'conflict', 'prerequisite']),
  retry: z.strictObject({
    eventId: identifier,
    token: z.uuid(),
    reason: z.enum(['io_retry', 'invalid_receipt']),
  }),
  acknowledgement: z.literal(true),
};
