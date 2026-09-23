/**
 * Jumia Stock Sync API Route
 * Push Baci stock levels to Jumia for synced product mappings.
 *
 * POST /api/marketplace/jumia/products/stock?integrationId={uuid}
 */

import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import {
  JumiaApiError,
  JumiaClient,
  jumiaErrorResponse,
} from '@/lib/jumia/client';
import { updateStock } from '@/lib/jumia/feeds';
import {
  getPushReadyJumiaStockMappings,
  loadJumiaStockMappings,
} from '@/lib/jumia/load-jumia-stock-mappings';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { getEffectiveStock } from '@/lib/product-stock';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { valid, response } = await checkCsrfProtection(request);
    if (!valid) {
      return (
        response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'integrations', 'manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const merchantId = merchantContext.merchantId;
    const { searchParams } = new URL(request.url);
    const rawIntegrationId = searchParams.get('integrationId');

    if (!rawIntegrationId) {
      return NextResponse.json(
        { error: 'integrationId is required' },
        { status: 400 }
      );
    }

    const integrationIdSchema = z.uuid('integrationId must be a valid UUID');
    const parsedIntegrationId = integrationIdSchema.safeParse(rawIntegrationId);
    if (!parsedIntegrationId.success) {
      return NextResponse.json(
        {
          error: 'Invalid integrationId',
          details: z.flattenError(parsedIntegrationId.error),
        },
        { status: 400 }
      );
    }
    const integrationId = parsedIntegrationId.data;

    const featureGateResponse = await requireMerchantFeatureAccess(
      supabase,
      merchantId,
      'marketplace_sync'
    );
    if (featureGateResponse) {
      return featureGateResponse;
    }

    let jumiaClient: JumiaClient;
    try {
      jumiaClient = await JumiaClient.forIntegration(
        supabase,
        merchantId,
        integrationId
      );
    } catch (clientError) {
      if (clientError instanceof JumiaApiError) {
        return jumiaErrorResponse(clientError);
      }
      throw clientError;
    }

    const { mappings, error: mappingsError } = await loadJumiaStockMappings(
      supabase,
      {
        merchantId,
        shopId: jumiaClient.shopId,
        marketplaceKey: jumiaClient.marketplaceKey,
      }
    );

    if (mappingsError) {
      console.error(
        '[Jumia Stock Sync] Failed to fetch mappings:',
        mappingsError
      );
      return NextResponse.json(
        { error: 'Failed to fetch product mappings' },
        { status: 500 }
      );
    }

    if (!mappings || mappings.length === 0) {
      return NextResponse.json({
        success: true,
        updated: 0,
        skipped: 0,
        message: 'No synced product mappings found',
      });
    }

    const { pushReady, skipped: initialSkipped } =
      getPushReadyJumiaStockMappings(mappings);
    let skipped = initialSkipped;

    if (pushReady.length === 0) {
      return NextResponse.json({
        success: true,
        updated: 0,
        skipped,
        message: 'No push-ready mappings (missing seller SKU or product ID)',
      });
    }

    const variantIds = Array.from(
      new Set(
        pushReady.flatMap((mapping) =>
          mapping.variant_id ? [mapping.variant_id] : []
        )
      )
    );
    const productOnlyIds = Array.from(
      new Set(pushReady.filter((m) => !m.variant_id).map((m) => m.product_id))
    );

    const variantStockMap = new Map<string, number>();
    const productStockMap = new Map<string, number>();
    let fetchErrors = 0;

    if (variantIds.length > 0) {
      const { data: variants, error: variantsError } = await supabase
        .from('product_variants')
        .select('id, stock_quantity')
        .in('id', variantIds);

      if (variantsError) {
        fetchErrors++;
        console.error(
          '[Jumia Stock Sync] Failed to fetch variant stock:',
          variantsError
        );
      }
      for (const v of variants || []) {
        variantStockMap.set(
          v.id,
          Math.max(0, Math.trunc(Number(v.stock_quantity) || 0))
        );
      }
    }

    if (productOnlyIds.length > 0) {
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('id, stock, stock_quantity')
        .in('id', productOnlyIds);

      if (productsError) {
        fetchErrors++;
        console.error(
          '[Jumia Stock Sync] Failed to fetch product stock:',
          productsError
        );
      }
      for (const p of products || []) {
        productStockMap.set(p.id, getEffectiveStock(p));
      }
    }

    const stockUpdates: Array<{
      mappingId: string;
      sellerSku: string;
      id: string;
      stock: number;
    }> = [];

    for (const mapping of pushReady) {
      const stock = mapping.variant_id
        ? variantStockMap.get(mapping.variant_id)
        : productStockMap.get(mapping.product_id);

      if (stock === undefined) {
        skipped++;
        continue;
      }

      if (stock === mapping.baci_stock_at_last_sync) {
        continue;
      }

      if (!mapping.jumia_seller_sku || !mapping.jumia_product_id) {
        skipped++;
        continue;
      }

      stockUpdates.push({
        mappingId: mapping.id,
        sellerSku: mapping.jumia_seller_sku,
        id: mapping.jumia_product_id,
        stock,
      });
    }

    if (stockUpdates.length === 0) {
      return NextResponse.json({
        success: true,
        updated: 0,
        skipped,
        message: 'All stock levels are up to date',
      });
    }

    const feedId = await updateStock(
      jumiaClient,
      stockUpdates.map(({ sellerSku, id, stock }) => ({
        sellerSku,
        id,
        stock,
      }))
    );

    const now = new Date().toISOString();
    let trackingFailures = 0;

    const bulkUpdates = stockUpdates.map((update) => ({
      id: update.mappingId,
      baci_stock_at_last_sync: update.stock,
      last_stock_synced_at: now,
      last_feed_id: feedId,
    }));

    const { error: bulkError } = await supabase
      .from('jumia_product_mappings')
      .upsert(bulkUpdates, { onConflict: 'id', ignoreDuplicates: false });

    if (bulkError) {
      trackingFailures = stockUpdates.length;
      console.error(
        '[Jumia Stock Sync] Bulk tracking update failed:',
        bulkError
      );
    }

    return NextResponse.json({
      success: true,
      updated: stockUpdates.length,
      skipped,
      feedId,
      ...(trackingFailures > 0 && { trackingFailures }),
      ...(fetchErrors > 0 && { fetchErrors: fetchErrors }),
      message: `Pushed ${stockUpdates.length} stock updates to Jumia`,
    });
  } catch (error) {
    if (error instanceof JumiaApiError) {
      return jumiaErrorResponse(error);
    }
    console.error('[Jumia Stock Sync] Error:', error);
    return NextResponse.json({ error: 'Stock sync failed' }, { status: 500 });
  }
}
