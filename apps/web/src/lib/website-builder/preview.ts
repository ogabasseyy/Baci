import { builderError } from '@/lib/builder-connector/errors';
import type {
  BuilderContext,
  PreviewInput,
} from '@/lib/builder-connector/types';
import { getPrimaryProductImage } from '@/lib/product-image';
import { loadStoreLaunchReadiness } from '@/lib/store-readiness/load-store-launch-readiness';
import { getStorePublicationMissingItems } from '@/lib/store-readiness/store-publication-missing-items';
import { builderPreviewResultSchema } from '@/schemas/builder-mcp-results';
import {
  builderPreviewProductImagesSchema,
  hasSafeBuilderPreviewAssets,
} from '@/schemas/builder-preview-assets';
import { portableHomeSchema } from '@/schemas/portable-storefront';
import {
  DraftServiceError,
  requireBuilderScope,
} from './mutation-authorization';
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
  const [identity, catalog, readiness] = await Promise.all([
    ctx.supabase
      .from('merchants')
      .select(
        'id,template_id,slug,business_name,logo_url,currency:payout_currency'
      )
      .eq('id', ctx.merchantId)
      .single(),
    ctx.supabase
      .from('products')
      .select('id,merchant_id,name,price,images,slug')
      .eq('merchant_id', ctx.merchantId)
      .eq('status', 'active')
      .order('id')
      .limit(24),
    loadStoreLaunchReadiness({
      supabase: ctx.supabase,
      merchantId: ctx.merchantId,
    }),
  ]);
  if (identity.error || catalog.error)
    throw new DraftServiceError('OPERATION_FAILED');
  const products = (catalog.data ?? []).map((product) => ({
    id: product.id,
    merchant_id: product.merchant_id,
    name: product.name,
    price: product.price,
    slug: product.slug,
    image: getPrimaryProductImage(
      builderPreviewProductImagesSchema.parse(product.images)
    ),
  }));
  const projection = {
    config: config.data,
    identity: identity.data,
    catalog: {
      merchantId: ctx.merchantId,
      capturedAt: new Date().toISOString(),
      products,
    },
    inert: true as const,
  };
  if (!hasSafeBuilderPreviewAssets(projection))
    throw new DraftServiceError('UNSUPPORTED_TEMPLATE');
  const latest = await read(); // Re-check canonical consent/ownership after slower reads.
  if (latest.version !== input.expectedVersion)
    return builderError('STALE_DRAFT', latest.version);
  const missingItems = getStorePublicationMissingItems(readiness);
  return builderPreviewResultSchema.parse({
    storefrontId: ctx.merchantId,
    version: row.version,
    pageSlug: 'home',
    projection,
    readiness: { ready: missingItems.length === 0, missingItems },
  });
}
