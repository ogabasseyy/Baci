import { z } from 'zod';
import { prefundedCardProviderEvidenceSchemas as evidence } from './prefunded-card-provider-evidence';

const canonicalBase64 = (bytes?: number) =>
  z.string().refine((value) => {
    const decoded = Buffer.from(value, 'base64');
    return (
      decoded.toString('base64') === value &&
      (bytes === undefined || decoded.length === bytes)
    );
  });

export const prefundedCardLegacyProofSchemas = {
  encryptionKey: canonicalBase64(32),
  sealed: z.strictObject({
    payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
    ciphertext: canonicalBase64().refine(
      (value) => value.length <= 4 * Math.ceil(65536 / 3)
    ),
    nonce: canonicalBase64(12),
    authTag: canonicalBase64(16),
    keyVersion: z.literal('staging-v1'),
  }),
  legacy: z.strictObject({
    integrationId: z.uuid(),
    merchantId: z.uuid(),
    customerId: z.uuid(),
    goalId: z.uuid(),
    contributionId: z.uuid(),
    providerTransactionId: evidence.identifier,
    eventDataId: evidence.identifier,
    eventId: evidence.identifier,
    providerWalletId: evidence.identifier,
    providerCustomerId: evidence.identifier,
    amountKobo: z.number().int().positive().safe(),
    feeKobo: z.literal(0),
    reference: evidence.identifier,
    sessionId: evidence.identifier.nullable(),
    creditedAt: z.iso.datetime({ offset: true }),
  }),
  receiptIdentity: z.strictObject({
    receiptId: z.uuid(),
    payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
};
