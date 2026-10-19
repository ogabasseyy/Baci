import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExportVariation } from './export-product-source';

type ReserveArgs = {
  supabase: SupabaseClient;
  merchantId: string;
  productId: string;
  shopId: string;
  marketplaceKey: string;
  exportVariations: ExportVariation[];
  linkedProductId: string | null;
  variantIdsBySku: Map<string, string>;
};

async function resolveLinkedProductId(
  supabase: SupabaseClient,
  merchantId: string,
  linkedProductId: string | null,
  primarySku: string
): Promise<{ productId: string | null; error: unknown | null }> {
  if (linkedProductId) {
    return { productId: linkedProductId, error: null };
  }

  const { data: existingProduct, error } = await supabase
    .from('products')
    .select('id')
    .eq('merchant_id', merchantId)
    .eq('sku', primarySku)
    .maybeSingle();

  return { productId: existingProduct?.id ?? null, error };
}

export async function reserveJumiaExportMappings(args: ReserveArgs): Promise<
  | {
      ok: true;
      productId: string;
      variantIdsBySku: Map<string, string>;
      exportVariations: ExportVariation[];
    }
  | { ok: false; status: number; error: string; code: string }
> {
  const primarySku = args.exportVariations[0]?.sellerSku;
  if (!primarySku) {
    return {
      ok: false,
      status: 400,
      error: 'At least one exportable variation is required',
      code: 'jumia_export_invalid_variations',
    };
  }

  const linkedProduct = await resolveLinkedProductId(
    args.supabase,
    args.merchantId,
    args.linkedProductId,
    primarySku
  );
  if (linkedProduct.error) {
    return {
      ok: false,
      status: 500,
      error: 'Failed to resolve the local product for Jumia export',
      code: 'jumia_export_product_lookup_failed',
    };
  }
  const productId = linkedProduct.productId;
  if (!productId) {
    return {
      ok: false,
      status: 400,
      error: 'Product must exist locally before exporting to Jumia',
      code: 'jumia_export_product_missing',
    };
  }

  // Product creation is a top-level feed, so any live mapping in this
  // product/shop/marketplace scope blocks another create. Gating on the
  // requested SKU set would miss a synced mapping whose variant was
  // renamed locally (or left out of a partial retry) and submit a
  // duplicate create feed. Failed rows are cleared below and re-reserved.
  const { data: existingMappings, error: blockingError } = await args.supabase
    .from('jumia_product_mappings')
    .select('jumia_sku, sync_status')
    .eq('merchant_id', args.merchantId)
    .eq('product_id', productId)
    .eq('jumia_shop_id', args.shopId)
    .eq('marketplace_key', args.marketplaceKey);

  if (blockingError) {
    return {
      ok: false,
      status: 500,
      error: 'Failed to check existing Jumia mapping',
      code: 'jumia_export_mapping_check_failed',
    };
  }

  const hasExistingMapping = (existingMappings ?? []).some(
    (mapping) => mapping.sync_status !== 'error'
  );

  // Product creation is a top-level feed, not a variation update. If any
  // variation already has a non-error mapping, retrying only the rejected
  // variations could create a duplicate Jumia product.
  if (hasExistingMapping) {
    return {
      ok: false,
      status: 409,
      error:
        'This product is already mapped to Jumia for this integration. Update the existing listing instead.',
      code: 'jumia_mapping_exists',
    };
  }

  const exportVariations = args.exportVariations;

  const variantIdsBySku = new Map(args.variantIdsBySku);
  // Clear every failed mapping for this product/integration scope so removed
  // variants from a prior rejected export cannot poison later update feeds.
  const { error: clearError } = await args.supabase
    .from('jumia_product_mappings')
    .delete()
    .eq('merchant_id', args.merchantId)
    .eq('product_id', productId)
    .eq('jumia_shop_id', args.shopId)
    .eq('marketplace_key', args.marketplaceKey)
    .eq('sync_status', 'error');

  if (clearError) {
    return {
      ok: false,
      status: 500,
      error: 'Failed to replace a previously failed Jumia export mapping',
      code: 'jumia_export_reservation_failed',
    };
  }

  const mappingRows = exportVariations.map((variation) => ({
    merchant_id: args.merchantId,
    product_id: productId,
    variant_id: variantIdsBySku.get(variation.sellerSku) ?? null,
    jumia_sku: variation.sellerSku,
    jumia_seller_sku: variation.sellerSku,
    jumia_shop_id: args.shopId,
    marketplace_key: args.marketplaceKey,
    jumia_price: variation.price,
    sync_status: 'pending' as const,
    last_feed_id: null,
    last_synced_at: new Date().toISOString(),
  }));

  const { error: insertError } = await args.supabase
    .from('jumia_product_mappings')
    .insert(mappingRows);

  if (insertError) {
    if (insertError.code === '23505') {
      return {
        ok: false,
        status: 409,
        error:
          'This product export is already in progress or mapped for this integration.',
        code: 'jumia_mapping_exists',
      };
    }
    return {
      ok: false,
      status: 500,
      error: 'Failed to reserve Jumia export mapping',
      code: 'jumia_export_reservation_failed',
    };
  }

  return { ok: true, productId, variantIdsBySku, exportVariations };
}

export async function finalizeJumiaExportReservation(
  supabase: SupabaseClient,
  args: {
    merchantId: string;
    productId: string;
    shopId: string;
    marketplaceKey: string;
    feedId: string;
    exportVariations: ExportVariation[];
  }
): Promise<boolean> {
  const persistFeedId = async () => {
    const skus = args.exportVariations.map((variation) => variation.sellerSku);
    const { data, error } = await supabase
      .from('jumia_product_mappings')
      .update({
        last_feed_id: args.feedId,
        last_synced_at: new Date().toISOString(),
      })
      .eq('merchant_id', args.merchantId)
      .eq('product_id', args.productId)
      .eq('jumia_shop_id', args.shopId)
      .eq('marketplace_key', args.marketplaceKey)
      .in('jumia_sku', skus)
      .select('id');

    return !error && data?.length === new Set(skus).size;
  };

  return (await persistFeedId()) || (await persistFeedId());
}

export async function markJumiaExportReservationForReconciliation(
  supabase: SupabaseClient,
  args: {
    merchantId: string;
    productId: string;
    shopId: string;
    marketplaceKey: string;
    feedId: string;
    exportVariations: ExportVariation[];
  }
): Promise<boolean> {
  const skus = args.exportVariations.map((variation) => variation.sellerSku);
  const { data, error } = await supabase
    .from('jumia_product_mappings')
    .update({
      last_feed_id: args.feedId,
      // Keep the accepted feed pending so feed-status reconciliation can
      // recover the mapping even when finalization itself failed.
      sync_status: 'pending',
      sync_error: `Jumia accepted feed ${args.feedId}, but the local mapping could not store the feed ID`,
      last_synced_at: new Date().toISOString(),
    })
    .eq('merchant_id', args.merchantId)
    .eq('product_id', args.productId)
    .eq('jumia_shop_id', args.shopId)
    .eq('marketplace_key', args.marketplaceKey)
    .eq('sync_status', 'pending')
    .is('last_feed_id', null)
    .in('jumia_sku', skus)
    .select('id');

  return !error && data?.length === new Set(skus).size;
}

export async function releaseJumiaExportReservation(
  supabase: SupabaseClient,
  args: {
    merchantId: string;
    productId: string;
    shopId: string;
    marketplaceKey: string;
    exportVariations: ExportVariation[];
  }
): Promise<boolean> {
  const skus = args.exportVariations.map((variation) => variation.sellerSku);
  const { error: deleteError } = await supabase
    .from('jumia_product_mappings')
    .delete()
    .eq('merchant_id', args.merchantId)
    .eq('product_id', args.productId)
    .eq('jumia_shop_id', args.shopId)
    .eq('marketplace_key', args.marketplaceKey)
    .eq('sync_status', 'pending')
    .is('last_feed_id', null)
    .in('jumia_sku', skus);

  if (!deleteError) {
    return true;
  }

  const { error: markError } = await supabase
    .from('jumia_product_mappings')
    .update({
      sync_status: 'error',
      sync_error: `Failed to release export reservation: ${deleteError.message}`,
      last_synced_at: new Date().toISOString(),
    })
    .eq('merchant_id', args.merchantId)
    .eq('product_id', args.productId)
    .eq('jumia_shop_id', args.shopId)
    .eq('marketplace_key', args.marketplaceKey)
    .eq('sync_status', 'pending')
    .is('last_feed_id', null)
    .in('jumia_sku', skus);

  return !markError;
}
