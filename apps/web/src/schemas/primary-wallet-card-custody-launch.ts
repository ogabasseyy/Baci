import { z } from 'zod';
import { primaryWalletCardCustodySchemas as custody } from './primary-wallet-card-custody';

export const primaryCardCustodyLaunchSchemas = {
  binding: z.strictObject({
    deliveryContract: z.literal('approved-primary-card-crosswalk-file-v1'),
    integrationId: z.uuid(),
    environment: z.enum(['staging', 'production']),
    expiresAt: z.iso.datetime({ offset: true }),
    records: z
      .array(
        z.strictObject({ operationId: z.uuid(), crosswalk: custody.crosswalk })
      )
      .min(1)
      .max(1000),
  }),
  approval: z.strictObject({
    approved: z.literal('true'),
    path: z.string().regex(/^\//).max(4096),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
    issuerKey: z.string().min(32).max(4096),
  }),
};
