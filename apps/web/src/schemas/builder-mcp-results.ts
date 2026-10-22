import { z } from 'zod';
import { BUILDER_ERROR_MESSAGES } from '@/lib/builder-connector/errors';
import {
  BUILDER_EDITOR_URL,
  builderHttpsUrlSchema as https,
  builderIdSchema as id,
  builderHomePagesSchema as pages,
  builderReadinessSchema as readiness,
  builderRevisionSchema as revision,
} from './builder-mcp-primitives';
import {
  PORTABLE_RENDERER_VERSION,
  portableCatalogSchema,
  portableHomeSchema,
  portableIdentitySchema,
} from './portable-storefront';
export const builderCapabilitiesSchema = z.discriminatedUnion('supported', [
  z
    .object({
      supported: z.literal(true),
      templateId: z.literal('puck'),
      rendererVersion: z.literal(PORTABLE_RENDERER_VERSION),
      canEdit: z.literal(true),
      canPreview: z.literal(true),
      canPublish: z.literal(true),
      editorUrl: z.literal(BUILDER_EDITOR_URL),
    })
    .strict(),
  z
    .object({
      supported: z.literal(false),
      templateId: z.string().nullable(),
      rendererVersion: z.string().nullable(),
      canEdit: z.literal(false),
      canPreview: z.literal(false),
      canPublish: z.literal(false),
      reason: z.literal('UNSUPPORTED_TEMPLATE'),
      editorUrl: z.literal(BUILDER_EDITOR_URL),
    })
    .strict(),
]);
const draft = { storefrontId: id, version: revision };
const receipt = { ...draft, receiptId: id, publishedVersion: revision };
export const builderPublicationReceiptSchema = z.discriminatedUnion('status', [
  z
    .object({
      ...receipt,
      status: z.literal('verifying'),
      deliveryBlockedReason: z.string().max(500).optional(),
    })
    .strict(),
  z
    .object({
      ...receipt,
      status: z.literal('live'),
      publicUrl: https,
      verifiedAt: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      ...receipt,
      status: z.literal('superseded'),
      currentPublishedVersion: revision.nullable(),
      supersededByReceiptId: id.optional(),
    })
    .strict(),
]);
export const builderPublishResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      ...draft,
      status: z.literal('approval_required'),
      intentId: id,
      approvalUrl: https.refine((value) => {
        const url = new URL(value);
        return (
          url.origin === 'https://usebaci.com' &&
          url.pathname === '/builder/approve'
        );
      }),
    })
    .strict(),
  z
    .object({
      ...draft,
      status: z.literal('blocked'),
      missingItems: readiness.shape.missingItems,
    })
    .strict(),
  ...builderPublicationReceiptSchema.options,
]);
export const builderDraftResultSchema = z
  .object({ ...draft, changedPages: pages, status: z.literal('draft') })
  .strict();
export const builderQueuedEditResultSchema = z
  .object({
    storefrontId: id,
    operationId: id,
    sourceVersion: revision,
    status: z.literal('pending'),
  })
  .strict();
export const builderOperationResultSchema = z
  .object({
    storefrontId: id,
    operationId: id,
    sourceVersion: revision,
    status: z.enum([
      'pending',
      'running',
      'ready',
      'applied',
      'failed',
      'conflict',
    ]),
    summary: z.string().max(1000),
  })
  .strict();
export const builderStatusResultSchema = z
  .object({
    storefrontId: id,
    draftVersion: revision,
    publishedVersion: revision.nullable(),
    isPublished: z.boolean(),
    latestReceipt: builderPublicationReceiptSchema.nullable(),
    missingItems: readiness.shape.missingItems,
    pendingOperationIds: z.array(id).max(20),
    supportedPageSlugs: pages,
    capabilities: builderCapabilitiesSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.latestReceipt === null ||
      value.latestReceipt.storefrontId === value.storefrontId,
    'Receipt must belong to this storefront'
  );
export const builderListResultSchema = z
  .object({
    stores: z
      .array(
        z
          .object({
            storefrontId: id,
            name: z.string().min(1).max(200),
            slug: z.string().min(3).max(63),
            onboardingComplete: z.boolean(),
          })
          .strict()
      )
      .max(1),
    nextCursor: z.string().max(2048).nullable(),
  })
  .strict();
export const builderPreviewResultSchema = z
  .object({
    ...draft,
    pageSlug: z.literal('home'),
    projection: z
      .object({
        config: portableHomeSchema,
        identity: portableIdentitySchema,
        catalog: portableCatalogSchema,
        inert: z.literal(true),
      })
      .strict(),
    readiness,
  })
  .strict()
  .refine(
    (value) =>
      value.projection.catalog.merchantId === value.storefrontId &&
      value.projection.identity.id === value.storefrontId,
    'Catalog must belong to this storefront'
  );
export const builderFailureSchema = z
  .object({
    status: z.literal('error'),
    code: z.enum(
      Object.keys(BUILDER_ERROR_MESSAGES) as [
        keyof typeof BUILDER_ERROR_MESSAGES,
        ...(keyof typeof BUILDER_ERROR_MESSAGES)[],
      ]
    ),
    error: z.string().max(500),
    currentVersion: revision.optional(),
    editorUrl: z.literal(BUILDER_EDITOR_URL).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.code === 'STALE_DRAFT'
        ? value.currentVersion !== undefined
        : value.currentVersion === undefined) &&
      (value.code === 'UNSUPPORTED_TEMPLATE'
        ? value.editorUrl === BUILDER_EDITOR_URL
        : value.editorUrl === undefined),
    'Error details must match the error code'
  );
const result = <T extends z.ZodType>(schema: T) =>
  z.union([schema, builderFailureSchema]);
export const builderOutputSchemas = {
  list_storefronts: result(builderListResultSchema),
  get_storefront_status: result(builderStatusResultSchema),
  create_storefront_draft: result(builderDraftResultSchema),
  update_storefront_draft: result(builderQueuedEditResultSchema),
  get_storefront_operation: result(builderOperationResultSchema),
  apply_storefront_operation: result(builderDraftResultSchema),
  preview_storefront: result(builderPreviewResultSchema),
  publish_storefront: result(builderPublishResultSchema),
} as const;
export type DraftResult = z.infer<typeof builderDraftResultSchema>;
export type QueuedEditResult = z.infer<typeof builderQueuedEditResultSchema>;
export type OperationResult = z.infer<typeof builderOperationResultSchema>;
export type StorefrontStatusResult = z.infer<typeof builderStatusResultSchema>;
export type StorefrontListResult = z.infer<typeof builderListResultSchema>;
export type PreviewResult = z.infer<typeof builderPreviewResultSchema>;
export type PublishResult = z.infer<typeof builderPublishResultSchema>;
