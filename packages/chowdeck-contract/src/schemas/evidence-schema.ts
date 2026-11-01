import { z } from 'zod';

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const canonicalTimestampSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
});
const OFFICIAL_SOURCE_URLS = new Set([
  'https://chowdeck-api.readme.io/docs/getting-started.md',
  'https://chowdeck-api.readme.io/reference/authentication-1.md',
  'https://chowdeck-api.readme.io/reference/get-merchant-profile.md',
  'https://chowdeck-api.readme.io/docs/managing-your-menu.md',
  'https://chowdeck-api.readme.io/reference/create-menu-category.md',
  'https://chowdeck-api.readme.io/reference/list-menu-categories.md',
  'https://chowdeck-api.readme.io/reference/create-menu-item.md',
  'https://chowdeck-api.readme.io/reference/list-menu-items.md',
  'https://chowdeck-api.readme.io/reference/get-menu-item.md',
]);

export const evidenceCapabilitySchema = z.enum([
  'account.read',
  'authentication',
  'menu.manage',
  'menu.category.create',
  'menu.category.list',
  'menu.item.create',
  'menu.item.list',
  'menu.item.read',
  'errors',
  'catalog.read',
  'catalog.write',
]);

export const evidenceStatusSchema = z.enum([
  'documented',
  'independently_observed',
  'contradicted',
  'unproven',
]);

export const evidenceLimitationSchema = z.enum([
  'public_documentation_shape_only',
  'live_behavior_unproven',
  'pagination_semantics_unproven',
  'request_limit_unproven',
  'response_semantics_unproven',
  'provider_contract_unversioned',
  'quarantined_reference_only',
]);

export const evidenceFieldSchema = z
  .object({
    name: z.enum([
      'description',
      'images',
      'in_stock',
      'menu_category_id',
      'name',
      'path',
      'price',
      'reference',
    ]),
    type: z.enum(['string', 'integer', 'number', 'boolean', 'object', 'array']),
    required: z.boolean(),
  })
  .strict();

export const evidenceOperationSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('documented'),
      method: z.enum(['get', 'post']),
      pathTemplate: z.enum([
        '/merchant/',
        '/merchant/{merchantReference}/menucategory',
        '/merchant/{merchantReference}/menu',
        '/merchant/{merchantReference}/menu/{menuReference}',
      ]),
    })
    .strict(),
  z
    .object({
      status: z.enum(['not_applicable', 'unproven']),
    })
    .strict(),
]);

export const evidenceClaimSchema = z
  .object({
    capability: evidenceCapabilitySchema,
    status: evidenceStatusSchema,
    sourceUrl: z.url().refine((value) => value.startsWith('https://')),
    sourceKind: z.enum([
      'official_markdown',
      'official_json',
      'independent_observation',
    ]),
    operation: evidenceOperationSchema,
    requestFields: z.array(evidenceFieldSchema).max(64),
    responseFields: z.array(evidenceFieldSchema).max(64),
    authScheme: z.enum(['bearer', 'unproven', 'not_applicable']),
    pagination: z.enum(['documented', 'unproven', 'not_applicable']),
    limitations: z.array(evidenceLimitationSchema).max(16),
  })
  .strict()
  .superRefine((claim, context) => {
    if (!OFFICIAL_SOURCE_URLS.has(claim.sourceUrl)) {
      context.addIssue({
        code: 'custom',
        message: 'Unallowlisted official source',
        path: ['sourceUrl'],
      });
    }
  });

export const evidenceManifestInputSchema = z
  .object({
    contractVersion: z.literal(1),
    capturedAt: canonicalTimestampSchema,
    captureToolDigest: digestSchema,
    runMetrics: z
      .object({
        documentsAttempted: z.number().int().safe().nonnegative(),
        documentsCaptured: z.number().int().safe().nonnegative(),
        parsedNodes: z.number().int().safe().nonnegative(),
        parsedTextBytes: z.number().int().safe().nonnegative(),
        transferredBytes: z.number().int().safe().nonnegative(),
      })
      .strict(),
    claims: z.array(evidenceClaimSchema).max(128),
    limitations: z.array(evidenceLimitationSchema).max(32),
  })
  .strict();

export const evidenceManifestSchema = evidenceManifestInputSchema
  .extend({
    sanitizedProjectionDigest: digestSchema,
    digest: digestSchema,
  })
  .strict();

export type ChowdeckEvidenceClaimV1 = z.infer<typeof evidenceClaimSchema>;
export type ChowdeckEvidenceManifestInputV1 = z.infer<
  typeof evidenceManifestInputSchema
>;
export type ChowdeckEvidenceManifestV1 = z.infer<typeof evidenceManifestSchema>;
