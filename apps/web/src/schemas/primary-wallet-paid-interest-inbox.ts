import { z } from 'zod';
import { primaryWalletPaidInterestSchemas } from './primary-wallet-paid-interest';

const rawHex = z
  .string()
  .min(2)
  .max(131072)
  .regex(/^(?:[a-f0-9]{2})+$/);
const signature = z.string().regex(/^[a-f0-9]{128}$/);
const eventId = z.string().min(1).max(512);

export const primaryWalletPaidInterestInboxSchemas = {
  runtime: primaryWalletPaidInterestSchemas.runtime
    .omit({
      providerToken: true,
    })
    .extend({
      retainedWebhookSecrets: z
        .array(z.string().min(1).max(4096))
        .max(4)
        .default([]),
    }),
  enqueue: z.strictObject({ rawHex, signature }),
  intake: z.enum(['accepted', 'duplicate', 'quarantined', 'not_handled']),
  claim: z.strictObject({ batchSize: z.number().int().min(1).max(10) }),
  claims: z
    .array(
      z.strictObject({
        eventId,
        token: z.uuid(),
        rawHex,
        signature,
        bodyDigest: z.string().regex(/^[a-f0-9]{64}$/),
        attempts: z.number().int().min(1).max(50),
      })
    )
    .max(10),
  finish: z.strictObject({
    eventId,
    token: z.uuid(),
    outcome: z.enum([
      'credited',
      'duplicate',
      'prerequisite',
      'conflict',
      'io_retry',
      'invalid_receipt',
    ]),
  }),
  acknowledgement: z.literal(true),
};
