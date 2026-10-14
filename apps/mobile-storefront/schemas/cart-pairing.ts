import { z } from 'zod';
export const nativePairingHintSchema = z.object({
  merchantId: z.uuid(),
  destination: z.discriminatedUnion('type', [
    z.object({ type: z.literal('web') }),
    z.object({ type: z.literal('native'), app: z.literal('storefront') }),
  ]),
});

import { nativeCartSnapshotSchema } from './cart';
export const nativeHandoffPreviewSchema = z.object({
  status: z.enum(['pending', 'consumed', 'expired']),
  merchant: z.object({ id: z.uuid(), slug: z.string().nullable() }).nullable(),
  snapshot: nativeCartSnapshotSchema.nullable(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
});
