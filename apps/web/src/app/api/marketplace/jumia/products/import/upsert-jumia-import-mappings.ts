import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { sanitizeText, stripHtmlTags } from '@/lib/sanitize-core';
import type { FlatJumiaImportEntry } from './flatten-jumia-import-products';

export type JumiaImportMappingRow = {
  merchant_id: string;
  product_id: string;
  variant_id: string | null;
  jumia_sku: string;
  jumia_seller_sku: string;
  jumia_shop_id: string;
  marketplace_key: string;
  jumia_price: number;
  jumia_product_id: string | null;
  is_active: boolean;
  sync_status: string;
  last_synced_at: string;
};

export type JumiaImportProductRow = {
  merchant_id: string;
  name: string;
  description: string;
  price: number;
  sku: string;
  stock_level: number;
  is_active: boolean;
  images: string[];
};

type UpsertJumiaImportMappingsArgs = {
  supabase: SupabaseClient;
  rows: JumiaImportMappingRow[];
};

export function upsertJumiaImportMappings({
  supabase,
  rows,
}: UpsertJumiaImportMappingsArgs) {
  return supabase.from('jumia_product_mappings').upsert(rows, {
    onConflict: 'product_id,variant_id,jumia_shop_id,marketplace_key',
  });
}

type PersistJumiaImportEntriesArgs = {
  supabase: SupabaseClient;
  merchantId: string;
  shopId: string;
  marketplaceKey: string;
  flatEntries: FlatJumiaImportEntry[];
  existingProducts: Array<{ id: string; sku: string | null }>;
  mappedSkus: Set<string>;
};

type PersistJumiaImportEntriesResult = {
  created: number;
  linked: number;
  errors: number;
  warningMessages: string[];
};

/**
 * Links flattened import entries to existing products or creates the missing
 * products, then persists the marketplace mappings. Both upserts are
 * idempotent so repeated imports converge instead of duplicating rows.
 */
export async function persistJumiaImportEntries({
  supabase,
  merchantId,
  shopId,
  marketplaceKey,
  flatEntries,
  existingProducts,
  mappedSkus,
}: PersistJumiaImportEntriesArgs): Promise<PersistJumiaImportEntriesResult> {
  let created = 0;
  let linked = 0;
  let errors = 0;
  const warningMessages: string[] = [];

  const productBySku = new Map(
    existingProducts.filter((p) => p.sku).map((p) => [p.sku, p])
  );
  const existingProductIds = new Set(existingProducts.map((p) => p.id));

  // Process each variation
  const mappingRows: JumiaImportMappingRow[] = [];
  const newProductRows: JumiaImportProductRow[] = [];
  const pendingNewProductMappings = new Map<
    string,
    Omit<JumiaImportMappingRow, 'product_id'>
  >();

  for (const entry of flatEntries) {
    const { sku } = entry;

    const product = productBySku.get(sku);
    const localProductId = product?.id;
    const mappingBase = {
      merchant_id: merchantId,
      jumia_sku: sku,
      jumia_seller_sku: sku,
      jumia_shop_id: shopId,
      marketplace_key: marketplaceKey,
      variant_id: null,
      jumia_price: entry.price,
      jumia_product_id: entry.productId,
      is_active: true,
      sync_status: 'synced',
      last_synced_at: new Date().toISOString(),
    };

    if (localProductId) {
      // LINK EXISTING
      if (!mappedSkus.has(sku)) {
        mappingRows.push({ ...mappingBase, product_id: localProductId });
      }
    } else {
      // CREATE NEW PRODUCT
      newProductRows.push({
        merchant_id: merchantId,
        name:
          sanitizeText(stripHtmlTags(entry.name)) || 'Imported Jumia Product',
        description: sanitizeText(stripHtmlTags(entry.description)) || '',
        price: entry.price,
        sku,
        // Jumia product listing doesn't include stock; merchant sets stock after import
        stock_level: 0,
        is_active: false,
        images: entry.images,
      });
      pendingNewProductMappings.set(sku, mappingBase);
    }
  }

  // Upsert products (idempotent on SKU conflicts from repeated imports)
  let insertedProducts: { id: string; sku: string }[] = [];
  if (newProductRows.length) {
    const { data: newProductsData, error: upsertError } = await supabase
      .from('products')
      .upsert(newProductRows, { onConflict: 'merchant_id,sku' })
      .select('id, sku');

    if (upsertError || !newProductsData) {
      logger.error({
        message: 'Product bulk upsert failed',
        error: upsertError,
      });
      errors += newProductRows.length;
    } else {
      insertedProducts = newProductsData;
    }
  }

  for (const product of insertedProducts) {
    const mappingBase = pendingNewProductMappings.get(product.sku);
    if (mappingBase) {
      mappingRows.push({ ...mappingBase, product_id: product.id });
    }
  }

  // Upsert mappings (idempotent on repeated imports)
  if (mappingRows.length) {
    const { error: mappingUpsertError } = await upsertJumiaImportMappings({
      supabase,
      rows: mappingRows,
    });

    if (mappingUpsertError) {
      logger.error({
        message: 'Mapping bulk upsert failed',
        error: mappingUpsertError,
      });
      // Partial failure: products created but mappings failed
      if (insertedProducts.length > 0) {
        const msg = `${insertedProducts.length} products created but mapping upsert failed; re-run to link`;
        warningMessages.push(msg);
        logger.warn({ message: msg, error: mappingUpsertError });
        // Count products as created even though mappings failed
        created += insertedProducts.length;
      }
      errors += mappingRows.length;
    } else {
      const newProductIds = new Set(insertedProducts.map((p) => p.id));
      for (const row of mappingRows) {
        if (existingProductIds.has(row.product_id)) {
          linked += 1;
        } else if (newProductIds.has(row.product_id)) {
          created += 1;
        }
      }
    }
  }

  return { created, linked, errors, warningMessages };
}
