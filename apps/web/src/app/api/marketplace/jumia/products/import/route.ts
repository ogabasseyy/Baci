import { type NextRequest, NextResponse } from 'next/server';
import z from 'zod';
import {
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { JumiaClient } from '@/lib/jumia/client';
import { logger } from '@/lib/logger';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { flattenJumiaImportProducts } from './flatten-jumia-import-products';
import {
  loadJumiaImportContext,
  validateJumiaImportCurrency,
} from './load-jumia-import-context';
import { loadJumiaImportMappings } from './load-jumia-import-mappings';
import { persistJumiaImportEntries } from './upsert-jumia-import-mappings';

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

    const currencyCheck = await validateJumiaImportCurrency({
      supabase,
      merchantId,
      integrationId,
    });
    if (!currencyCheck.ok) {
      return NextResponse.json(
        { error: currencyCheck.error },
        { status: currencyCheck.status }
      );
    }

    if (!jumiaProducts.length) {
      return NextResponse.json({
        success: true,
        summary: { total: 0, created: 0, linked: 0, updated: 0, errors: 0 },
      });
    }

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

    const { created, linked, errors, warningMessages } =
      await persistJumiaImportEntries({
        supabase,
        merchantId,
        shopId: jumia.shopId,
        marketplaceKey: jumia.marketplaceKey,
        flatEntries,
        existingProducts,
        mappedSkus,
      });

    // TODO: Implement update-on-reimport to populate this counter
    const updated = 0;

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
