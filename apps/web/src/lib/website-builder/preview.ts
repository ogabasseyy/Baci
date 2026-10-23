import { builderError } from '@/lib/builder-connector/errors';
import type {
  BuilderContext,
  PreviewInput,
} from '@/lib/builder-connector/types';
import { hasSafeBuilderPreviewAssets } from '@/schemas/builder-preview-assets';
import { portableHomeSchema } from '@/schemas/portable-storefront';
import {
  DraftServiceError,
  requireBuilderScope,
} from './mutation-authorization';
import { loadPreviewData } from './preview-data';
import { readBuilderStorefronts } from './read-storefront';
/** Read-only, current exact revision. Publication will reuse this inert projection. */
export async function previewStorefront(
  ctx: BuilderContext,
  input: PreviewInput
) {
  requireBuilderScope(ctx.identity, 'storefront.read');
  if (input.pageSlug !== 'home')
    throw new DraftServiceError('UNSUPPORTED_PAGE');
  if (input.storefrontId !== ctx.merchantId)
    throw new DraftServiceError('NOT_FOUND');
  const read = async () => {
    const [row] = await readBuilderStorefronts(
      ctx.supabase,
      ctx.identity,
      ctx.merchantId
    );
    if (!row?.version) throw new DraftServiceError('NOT_FOUND');
    return { ...row, version: row.version };
  };
  const row = await read();
  if (row.version !== input.expectedVersion)
    return builderError('STALE_DRAFT', row.version);
  const config = portableHomeSchema.safeParse(row.draft_config);
  if (
    row.template_id !== 'puck' ||
    !config.success ||
    !hasSafeBuilderPreviewAssets(config.data)
  )
    throw new DraftServiceError('UNSUPPORTED_TEMPLATE');
  const preview = await loadPreviewData(ctx, config.data, row.version);
  const latest = await read(); // Re-check canonical consent/ownership after slower reads.
  if (latest.version !== input.expectedVersion)
    return builderError('STALE_DRAFT', latest.version);
  return preview;
}
