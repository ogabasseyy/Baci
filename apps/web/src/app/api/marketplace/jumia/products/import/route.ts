import { type NextRequest, NextResponse } from 'next/server';
import z from 'zod';
import {
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { JumiaClient } from '@/lib/jumia/client';
import {
  loadJumiaMarketplaceCurrency,
  validateJumiaMarketplaceCurrencyForMerchant,
} from '@/lib/jumia/jumia-marketplace-currency';
import { logger } from '@/lib/logger';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { sanitizeText, stripHtmlTags } from '@/lib/sanitize-core';
import { flattenJumiaImportProducts } from './flatten-jumia-import-products';
import { loadJumiaImportContext } from './load-jumia-import-context';
import { loadJumiaImportMappings } from './load-jumia-import-mappings';
import {
  type JumiaImportMappingRow,
  type JumiaImportProductRow,
  upsertJumiaImportMappings,
} from './upsert-jumia-import-mappings';

const ImportSchema = z.object({
  integrationId: z.uuid(),
  merchantId: z.uuid().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { valid, response } = await checkCsrfProtection(req);
    if (!valid) {
      return (
        response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const auth = await authenticateApiRequest(req);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = ImportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { integrationId, merchantId: requestedMerchantId } = parsed.data;

    const access = await getUserAccess(auth.supabase);
    if (!access) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const merchantId = access.merchantId;

    if (!hasPermission(access, 'integrations', 'manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (requestedMerchantId && requestedMerchantId !== merchantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const featureGateResponse = await requireMerchantFeatureAccess(
      auth.supabase,
      merchantId,
      'marketplace_sync'
    );
    if (featureGateResponse) {
      return featureGateResponse;
    }

    const supabase = auth.supabase;
    const context = await loadJumiaImportContext({
      createJumiaClient: () =>
        JumiaClient.forIntegration(supabase, merchantId, integrationId),
    });
    if (!context.ok) {
      return NextResponse.json(
        { error: context.error },
        { status: context.status }
      );
    }
    const { jumia, jumiaProducts } = context;

    // Provider prices carry no currency; a marketplace/merchant mismatch
    // would store foreign-denominated amounts as local prices.
    const currencyResult = await loadJumiaMarketplaceCurrency(
      supabase,
      merchantId,
      integrationId
    );
    if (!currencyResult.ok) {
      return NextResponse.json(
        { error: currencyResult.error },
        { status: currencyResult.status }
      );
    }

    const merchantCurrencyResult =
      await validateJumiaMarketplaceCurrencyForMerchant(
        supabase,
        merchantId,
        currencyResult.currency
      );
    if (!merchantCurrencyResult.ok) {
      return NextResponse.json(
        { error: merchantCurrencyResult.error },
        { status: merchantCurrencyResult.status }
      );
    }

    if (!jumiaProducts.length) {
      return NextResponse.json({
        success: true,
        summary: { total: 0, created: 0, linked: 0, updated: 0, errors: 0 },
      });
    }

    let created = 0;
    let linked = 0;
    let errors = 0;
    const warningMessages: string[] = [];
    // TODO: Implement update-on-reimport to populate this counter
    const updated = 0;

    const { flatEntries, skippedNoSkuCount, missingPriceCount } =
      flattenJumiaImportProducts(jumiaProducts);

    const skus = flatEntries.map((e) => e.sku);

    if (!skus.length) {
      return NextResponse.json({
        success: true,
        summary: {
          total: jumiaProducts.length,
          created: 0,
          linked: 0,
          updated: 0,
          errors: 0,
        },
        warnings: {
          skippedNoSku: skippedNoSkuCount,
          missingPrice: missingPriceCount,
        },
      });
    }

    const { data: existingProductsData, error: productsQueryError } =
      await supabase
        .from('products')
        .select('id, sku')
        .eq('merchant_id', merchantId)
        .in('sku', skus);

    if (productsQueryError) {
      logger.error({
        message: 'Failed to query existing products',
        error: productsQueryError,
      });
      return NextResponse.json(
        { error: 'Failed to query existing products' },
        { status: 500 }
      );
    }

    const existingProducts = existingProductsData || [];
    const productBySku = new Map(
      existingProducts.filter((p) => p.sku).map((p) => [p.sku, p])
    );
    const existingProductIds = new Set(existingProducts.map((p) => p.id));

    const mappingsResult = await loadJumiaImportMappings({
      supabase,
      merchantId,
      shopId: jumia.shopId,
      marketplaceKey: jumia.marketplaceKey,
      skus,
    });
    if (!mappingsResult.ok) {
      return NextResponse.json(
        { error: 'Failed to query existing mappings' },
        { status: 500 }
      );
    }
    const { mappedSkus } = mappingsResult;

    // 3. Process each variation
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
        jumia_shop_id: jumia.shopId,
        marketplace_key: jumia.marketplaceKey,
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

    return NextResponse.json({
      success: true,
      summary: {
        total: flatEntries.length,
        created,
        linked,
        updated,
        errors,
      },
      warnings: {
        skippedNoSku: skippedNoSkuCount,
        missingPrice: missingPriceCount,
      },
      ...(warningMessages.length > 0 && { warningMessages }),
    });
  } catch (error) {
    logger.error({ message: 'Import error', error });
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
