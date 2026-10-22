import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type {
  BuilderContext,
  BuilderIdentity,
  ListInput,
} from '@/lib/builder-connector/types';
import { BUILDER_EDITOR_URL } from '@/schemas/builder-mcp-primitives';
import {
  builderListResultSchema,
  builderStatusResultSchema,
} from '@/schemas/builder-mcp-results';
import { portableHomeSchema } from '@/schemas/portable-storefront';
import type { DraftServiceDependencies } from './context';
import {
  DraftServiceError,
  requireBuilderScope,
  safeDatabaseFailure,
} from './mutation-authorization';

const rowsSchema = z
  .array(
    z.object({
      id: z.uuid(),
      business_name: z.string().nullable(),
      slug: z.string().nullable(),
      template_id: z.string().nullable(),
      draft_config: z.unknown(),
      version: z.string().nullable(),
      is_published: z.boolean(),
      pendingOperationIds: z.array(z.uuid()).max(20).default([]),
    })
  )
  .max(1);
async function read(
  client: SupabaseClient,
  identity: BuilderIdentity,
  merchantId?: string
) {
  requireBuilderScope(identity, 'storefront.read');
  const { data, error } = await client.rpc('builder_read_storefronts', {
    p_connection: identity.connectionId,
    p_version: identity.grantVersion,
    p_merchant: merchantId ?? null,
  });
  if (error) safeDatabaseFailure(error);
  return rowsSchema.parse(data);
}
export function createListStorefrontsService(deps: DraftServiceDependencies) {
  return async (identity: BuilderIdentity, input: ListInput) => {
    if (input.cursor) throw new DraftServiceError('INVALID_REQUEST');
    const rows = await read(await deps.resolveUserClient(identity), identity);
    return builderListResultSchema.parse({
      stores: rows
        .filter((row) => row.slug && row.business_name)
        .map((row) => ({
          storefrontId: row.id,
          name: row.business_name,
          slug: row.slug,
          onboardingComplete: row.version !== null,
        })),
      nextCursor: null,
    });
  };
}
export async function getStorefrontStatus(ctx: BuilderContext) {
  const [row] = await read(ctx.supabase, ctx.identity, ctx.merchantId);
  if (!row?.version) throw new DraftServiceError('NOT_FOUND');
  const portable = portableHomeSchema.safeParse(row.draft_config);
  const supported = row.template_id === 'puck' && portable.success;
  return builderStatusResultSchema.parse({
    storefrontId: row.id,
    draftVersion: row.version,
    publishedVersion: null,
    isPublished: row.is_published,
    latestReceipt: null,
    missingItems: ['Launch readiness has not been assessed.'],
    pendingOperationIds: row.pendingOperationIds,
    supportedPageSlugs: ['home'],
    capabilities: supported
      ? {
          supported: true,
          templateId: 'puck',
          rendererVersion: 'baci-home-six-v1',
          canEdit: true,
          canPreview: true,
          canPublish: true,
          editorUrl: BUILDER_EDITOR_URL,
        }
      : {
          supported: false,
          templateId: row.template_id,
          rendererVersion: null,
          canEdit: false,
          canPreview: false,
          canPublish: false,
          reason: 'UNSUPPORTED_TEMPLATE',
          editorUrl: BUILDER_EDITOR_URL,
        },
  });
}
