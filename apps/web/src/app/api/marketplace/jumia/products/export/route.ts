import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  authenticateApiRequest,
  getMerchantIdForApiUser,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { JumiaClient } from '@/lib/jumia/client';
import { JumiaApiError } from '@/lib/jumia/helpers';
import {
  loadJumiaMarketplaceCurrency,
  validateJumiaMarketplaceCurrencyForMerchant,
} from '@/lib/jumia/jumia-marketplace-currency';
import { logger } from '@/lib/logger';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { jumiaExportProductSchema } from '@/schemas/jumia/export-product';
import { reserveJumiaExportMappings } from './export-product-reservation';
import { resolveAuthorizedExportProduct } from './export-product-source';
import { submitJumiaExportFeed } from './submit-jumia-export-feed';

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateApiRequest(req);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { valid, response } = await checkCsrfProtection(req);
    if (!valid) {
      return (
        response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = jumiaExportProductSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const {
      integrationId,
      merchantId: requestedMerchantId,
      productId,
      brand,
      category,
      variations: requestedVariations,
    } = parsed.data;

    const merchantId = await getMerchantIdForApiUser(auth.supabase);
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    if (requestedMerchantId && requestedMerchantId !== merchantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const supabase = auth.supabase;
    const access = await getUserAccess(supabase);
    if (!access || !hasPermission(access, 'integrations', 'manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const featureGateResponse = await requireMerchantFeatureAccess(
      supabase,
      merchantId,
      'marketplace_sync'
    );
    if (featureGateResponse) {
      return featureGateResponse;
    }

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

    const resolved = await resolveAuthorizedExportProduct(
      supabase,
      merchantId,
      productId,
      currencyResult.currency
    );
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.error },
        { status: resolved.status }
      );
    }

    const {
      name: exportName,
      description: exportDescription,
      images: exportImages,
      variations: resolvedVariations,
      productId: linkedProductId,
      variantIdsBySku,
    } = resolved.product;
    // Prices, stock, and SKU identity come from the merchant-owned product;
    // only the validated catalog attributes are accepted from the request.
    const requestedAttributesBySku = new Map(
      requestedVariations.map((variation) => [
        variation.sellerSku,
        variation.attributes,
      ])
    );
    const exportVariations = resolvedVariations.map((variation) => ({
      ...variation,
      attributes: requestedAttributesBySku.get(variation.sellerSku),
    }));

    let jumia: JumiaClient;
    try {
      jumia = await JumiaClient.forIntegration(
        supabase,
        merchantId,
        integrationId
      );
    } catch (clientError) {
      if (clientError instanceof JumiaApiError) {
        logger.error({
          message: 'Jumia integration error',
          error: clientError,
          status: clientError.status,
        });
        return NextResponse.json(
          { error: clientError.message },
          { status: clientError.status }
        );
      }
      logger.error({
        message: 'Jumia integration initialization failed',
        error: clientError,
      });
      const errorMessage = String(
        clientError instanceof Error ? clientError.message : clientError
      );
      const isExpired =
        errorMessage.toLowerCase().includes('expired') ||
        errorMessage.toLowerCase().includes('unauthorized');
      const isNotFound = errorMessage.toLowerCase().includes('not found');
      return NextResponse.json(
        {
          error: isExpired
            ? 'Jumia credentials expired — please reconnect'
            : isNotFound
              ? 'Jumia integration not found'
              : 'Jumia integration initialization failed',
        },
        { status: isExpired ? 401 : isNotFound ? 404 : 502 }
      );
    }

    const reservation = await reserveJumiaExportMappings({
      supabase,
      merchantId,
      productId: linkedProductId ?? productId,
      shopId: jumia.shopId,
      marketplaceKey: jumia.marketplaceKey,
      exportVariations,
      linkedProductId,
      variantIdsBySku,
    });
    if (!reservation.ok) {
      return NextResponse.json(
        { error: reservation.error, code: reservation.code },
        { status: reservation.status }
      );
    }

    const submitted = await submitJumiaExportFeed({
      jumia,
      supabase,
      merchantId,
      productId: reservation.productId,
      shopId: jumia.shopId,
      marketplaceKey: jumia.marketplaceKey,
      exportName,
      exportDescription,
      exportImages,
      brand,
      category,
      exportVariations: reservation.exportVariations,
    });
    if (!submitted.ok) {
      return NextResponse.json(submitted.body, { status: submitted.status });
    }

    const primarySku = reservation.exportVariations[0]?.sellerSku ?? '';

    return NextResponse.json({
      success: true,
      feedId: submitted.feedId,
      message:
        'Product export initiated. Check Jumia Vendor Center for status.',
      note: `Product mapping reserved for SKU "${primarySku}".`,
    });
  } catch (error) {
    logger.error({ message: 'Export error', error });
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
