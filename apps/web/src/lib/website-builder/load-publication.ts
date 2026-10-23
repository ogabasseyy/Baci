import type { SupabaseClient } from '@supabase/supabase-js';
import type { BuilderContext } from '@/lib/builder-connector/types';
import { builderPreviewResultSchema } from '@/schemas/builder-mcp-results';
import { hasSafeBuilderPreviewAssets } from '@/schemas/builder-preview-assets';
import type {
  PublicationConfirmationView,
  StoredPublication,
} from '@/schemas/builder-publication';
import { portableHomeSchema } from '@/schemas/portable-storefront';
import { loadPreviewData } from './preview-data';
import { readStoredPublication } from './publication-rpc';
import { readBuilderStorefronts } from './read-storefront';
export function publicationContext(
  client: SupabaseClient,
  record: Exclude<StoredPublication, { receipt: unknown }>
): BuilderContext {
  return {
    supabase: client as BuilderContext['supabase'],
    merchantId: record.intent.storefrontId,
    identity: { ...record.identity, scopes: new Set(record.identity.scopes) },
  };
}
export async function projectBoundPublication(
  client: SupabaseClient,
  record: Exclude<StoredPublication, { receipt: unknown }>
) {
  const ctx = publicationContext(client, record);
  const config = portableHomeSchema.parse(record.config);
  if (!hasSafeBuilderPreviewAssets(config))
    throw new Error('Unsupported snapshot');
  const preview = builderPreviewResultSchema.parse(
    await loadPreviewData(ctx, config, record.intent.draftVersion)
  );
  const [latest] = await readBuilderStorefronts(
    ctx.supabase,
    ctx.identity,
    ctx.merchantId
  );
  if (!latest?.version) throw new Error('Storefront unavailable');
  return { preview, currentVersion: latest.version, ctx };
}
export async function loadPublishConfirmation(
  client: SupabaseClient,
  intentId: string
): Promise<PublicationConfirmationView> {
  const record = await readStoredPublication(client, intentId);
  if ('receipt' in record) return { kind: 'receipt', receipt: record.receipt };
  const base = {
    kind: 'approval' as const,
    intentId: record.intent.intentId,
    destinationUrl: record.intent.destinationUrl,
    version: record.intent.draftVersion,
  };
  try {
    const { preview, currentVersion } = await projectBoundPublication(
      client,
      record
    );
    const reason =
      Date.parse(record.intent.expiresAt) <= Date.now()
        ? 'expired'
        : currentVersion !== record.intent.draftVersion
          ? 'stale'
          : !preview.readiness.ready
            ? 'blocked'
            : 'ready';
    return { ...base, preview, canConfirm: reason === 'ready', reason };
  } catch {
    return { ...base, preview: null, canConfirm: false, reason: 'unsupported' };
  }
}
