import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import type { ExportVariation } from './export-product-source';

export function applyMarketplaceCurrency<T extends { currency?: string }>(
  variations: T[],
  currency: string
): Array<T & { currency: string }> {
  return variations.map((variation) => ({
    ...variation,
    currency,
  }));
}

export function createPartialExportResponse(
  feedId: string,
  message: string,
  extra: Record<string, unknown> = {}
) {
  return NextResponse.json(
    {
      success: false,
      partial: true,
      feedId,
      error: message,
      message,
      ...extra,
    },
    { status: 207 }
  );
}

type LinkExportMappingsArgs = {
  supabase: SupabaseClient;
  merchantId: string;
  shopId: string;
  marketplaceKey: string;
  feedId: string;
  exportVariations: ExportVariation[];
  linkedProductId: string | null;
  variantIdsBySku: Map<string, string>;
};

export async function linkExportProductMappings({
  supabase,
  merchantId,
  shopId,
  marketplaceKey,
  feedId,
  exportVariations,
  linkedProductId,
  variantIdsBySku,
}: LinkExportMappingsArgs): Promise<
  | { ok: true; linkedProductId: string | null; primarySku: string }
  | { ok: false; response: ReturnType<typeof createPartialExportResponse> }
> {
  const primarySku = exportVariations[0]?.sellerSku;
  if (!primarySku) {
    return { ok: true, linkedProductId, primarySku: '' };
  }

  let productId = linkedProductId;
  const skuVariantMap = new Map(variantIdsBySku);

  if (!productId) {
    const { data: existingProduct, error: lookupError } = await supabase
      .from('products')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('sku', primarySku)
      .maybeSingle();

    if (lookupError) {
      logger.error({
        message: 'Product lookup by SKU failed',
        error: lookupError,
        sku: primarySku,
      });
      return {
        ok: false,
        response: createPartialExportResponse(
          feedId,
          'Product export initiated but local product lookup failed. Retry reconciliation before republishing.',
          { lookupFailed: true }
        ),
      };
    }

    if (existingProduct) {
      productId = existingProduct.id;
      const { data: productVariants, error: variantsError } = await supabase
        .from('product_variants')
        .select('id, sku')
        .eq('merchant_id', merchantId)
        .eq('product_id', existingProduct.id)
        .in(
          'sku',
          exportVariations.map((variation) => variation.sellerSku)
        );
      if (variantsError) {
        logger.error({
          message: 'Product variant lookup failed',
          error: variantsError,
        });
        return {
          ok: false,
          response: createPartialExportResponse(
            feedId,
            'Product export initiated but local variant lookup failed. Retry reconciliation before republishing.',
            { lookupFailed: true }
          ),
        };
      }
      for (const variant of productVariants ?? []) {
        if (variant.sku) skuVariantMap.set(variant.sku, variant.id);
      }
    }
  }

  if (!productId) {
    return { ok: true, linkedProductId: null, primarySku };
  }

  const mappingRows = exportVariations.map((variation) => ({
    merchant_id: merchantId,
    product_id: productId,
    variant_id: skuVariantMap.get(variation.sellerSku) ?? null,
    jumia_sku: variation.sellerSku,
    jumia_seller_sku: variation.sellerSku,
    jumia_shop_id: shopId,
    marketplace_key: marketplaceKey,
    jumia_price: variation.price,
    sync_status: 'pending',
    last_feed_id: feedId,
    last_synced_at: new Date().toISOString(),
  }));
  const { error: upsertError } = await supabase
    .from('jumia_product_mappings')
    .upsert(mappingRows, {
      onConflict: 'product_id,variant_id,jumia_shop_id,marketplace_key',
    });
  if (upsertError) {
    logger.error({ message: 'Mapping upsert failed', error: upsertError });
    return {
      ok: false,
      response: createPartialExportResponse(
        feedId,
        'Product export initiated but local mapping failed to save.'
      ),
    };
  }

  return { ok: true, linkedProductId: productId, primarySku };
}
