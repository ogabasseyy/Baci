import type { BuilderContext } from '@/lib/builder-connector/types';
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

/** Internal bound-snapshot projection; callers perform canonical checks around these reads. */
export async function loadPreviewData(
  ctx: BuilderContext,
  boundConfig: unknown,
  version: string
) {
  requireBuilderScope(ctx.identity, 'storefront.read');
  const config = portableHomeSchema.safeParse(boundConfig);
  if (!config.success || !hasSafeBuilderPreviewAssets(config.data))
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
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
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
  const missingItems = getStorePublicationMissingItems(readiness);
  return builderPreviewResultSchema.parse({
    storefrontId: ctx.merchantId,
    version,
    pageSlug: 'home',
    projection,
    readiness: { ready: missingItems.length === 0, missingItems },
  });
}
