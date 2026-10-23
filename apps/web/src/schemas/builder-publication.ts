import { z } from 'zod';
import {
  builderHttpsUrlSchema,
  builderRevisionSchema,
} from './builder-mcp-primitives';
import {
  builderPreviewResultSchema,
  builderPublicationReceiptSchema,
} from './builder-mcp-results';
import { builderPublishIntentSchema } from './builder-publish-binding';
export const storedPublicationSchema = z.union([
  z.object({ receipt: builderPublicationReceiptSchema }).strict(),
  z
    .object({
      intent: builderPublishIntentSchema,
      config: z.unknown(),
      currentVersion: builderRevisionSchema,
      identity: z
        .object({
          actorUserId: z.uuid(),
          connectionId: z.uuid(),
          grantVersion: z.int().positive(),
          scopes: z.array(
            z.enum([
              'storefront.read',
              'storefront.write',
              'storefront.publish',
            ])
          ),
          allowedMerchantIds: z.array(z.uuid()),
          allowCreateStore: z.boolean(),
        })
        .strict(),
    })
    .strict(),
]);
export const publicationConfirmationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('receipt'),
      receipt: builderPublicationReceiptSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('approval'),
      intentId: z.uuid(),
      destinationUrl: builderHttpsUrlSchema,
      version: builderRevisionSchema,
      preview: builderPreviewResultSchema.nullable(),
      canConfirm: z.boolean(),
      reason: z.enum(['ready', 'stale', 'expired', 'blocked', 'unsupported']),
    })
    .strict(),
]);
export type PublicationConfirmationView = z.infer<
  typeof publicationConfirmationSchema
>;
export type StoredPublication = z.infer<typeof storedPublicationSchema>;
export const publicationPostSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm'), intentId: z.uuid() }).strict(),
  z.object({ action: z.literal('retry'), receiptId: z.uuid() }).strict(),
]);
export const deliveryClaimSchema = z
  .object({
    result: builderPublicationReceiptSchema,
    leaseId: z.uuid().optional(),
    destinationUrl: builderHttpsUrlSchema.optional(),
    intentId: z.uuid().optional(),
    effectDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    config: z.unknown().optional(),
  })
  .strict();
export const publicationProofSchema = z
  .object({
    intentId: z.uuid(),
    receiptId: z.uuid().nullable(),
    kind: z.enum(['render', 'delivery']),
    version: z.string().regex(/^(draft|published):[a-f0-9-]{36}$/),
    effectDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type PublicationProof = z.infer<typeof publicationProofSchema>;
