import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { flattenError } from 'zod';
import { checkCsrfProtection } from '@/lib/csrf';
import { JumiaClient } from '@/lib/jumia/client';
import { JumiaApiError } from '@/lib/jumia/helpers';
import { loadJumiaMarketplaceCurrency } from '@/lib/jumia/jumia-marketplace-currency';
import { loadIntegrationScopedMappings } from '@/lib/jumia/product-mapping-scope';
import { logger } from '@/lib/logger';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { createClient } from '@/lib/supabase/server';
import { jumiaProductUpdateSchema } from '@/schemas/jumia-product-update';
import {
  getJumiaPriceOverrideError,
  getJumiaProductUpdateReadiness,
  hasJumiaPriceOverrides,
  pushPriceUpdates,
  pushStatusUpdates,
} from './jumia-product-update-feeds';

export async function POST(request: NextRequest) {
  try {
    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = jumiaProductUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const { productId, integrationId, overrides } = parsed.data;

    const { data: merchant, error: merchantError } = await supabase
      .from('merchants')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (merchantError) {
      if (merchantError.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Merchant not found' },
          { status: 404 }
        );
      }
      logger.error({
        message: 'Failed to query merchant',
        error: merchantError,
      });
      return NextResponse.json(
        { error: 'Failed to look up merchant' },
        { status: 500 }
      );
    }

    const merchantId = merchant.id;
    const featureGateResponse = await requireMerchantFeatureAccess(
      supabase,
      merchantId,
      'marketplace_sync'
    );
    if (featureGateResponse) {
      return featureGateResponse;
    }

    let client: JumiaClient;
    try {
      client = await JumiaClient.forIntegration(
        supabase,
        merchantId,
        integrationId
      );
    } catch (err: unknown) {
      if (err instanceof JumiaApiError && err.status === 404) {
        return NextResponse.json(
          { error: `Jumia integration not found: ${integrationId}` },
          { status: 404 }
        );
      }
      throw err;
    }

    const { mappings, error: mappingError } =
      await loadIntegrationScopedMappings({
        supabase,
        merchantId,
        productId,
        shopId: client.shopId,
        marketplaceKey: client.marketplaceKey,
      });
    if (mappingError) {
      logger.error({
        message: 'Failed to load Jumia mappings',
        error: mappingError,
      });
      return NextResponse.json(
        { error: 'Failed to load Jumia mappings' },
        { status: 500 }
      );
    }
    if (mappings.length === 0) {
      return NextResponse.json(
        { error: 'Jumia mapping not found' },
        { status: 404 }
      );
    }
    const readyMappings = mappings.filter(
      (mapping) => mapping.jumia_product_id
    );
    const needsPriceUpdate = hasJumiaPriceOverrides(overrides);
    const readiness = getJumiaProductUpdateReadiness(
      mappings,
      Object.hasOwn(overrides, 'is_active'),
      needsPriceUpdate
    );
    if (readiness) {
      return NextResponse.json(
        { success: false, feedIds: [], ...readiness },
        { status: 409 }
      );
    }
    const priceOverrideError = getJumiaPriceOverrideError(
      readyMappings,
      overrides
    );
    if (priceOverrideError) {
      return NextResponse.json({ error: priceOverrideError }, { status: 400 });
    }
    let marketplaceCurrency: string | undefined;
    if (needsPriceUpdate) {
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
      marketplaceCurrency = currencyResult.currency;
    }
    const mappingUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (Object.hasOwn(overrides, 'jumia_price')) {
      mappingUpdate.jumia_price = overrides.jumia_price;
    }
    if (Object.hasOwn(overrides, 'is_active')) {
      mappingUpdate.is_active = overrides.is_active;
    }
    if (Object.hasOwn(overrides, 'jumia_sale_price')) {
      mappingUpdate.jumia_sale_price = overrides.jumia_sale_price;
    }
    if (Object.hasOwn(overrides, 'jumia_sale_start')) {
      mappingUpdate.jumia_sale_start = overrides.jumia_sale_start;
    }
    if (Object.hasOwn(overrides, 'jumia_sale_end')) {
      mappingUpdate.jumia_sale_end = overrides.jumia_sale_end;
    }
    const mappingIds = readyMappings.map((mapping) => mapping.id);
    const { error: updateError } = await supabase
      .from('jumia_product_mappings')
      .update(mappingUpdate)
      .in('id', mappingIds)
      .eq('merchant_id', merchantId);

    if (updateError) {
      logger.error({
        message: 'Local mapping update failed',
        error: updateError,
      });
      return NextResponse.json(
        { error: 'Failed to update local mapping' },
        { status: 500 }
      );
    }

    if (overrides.jumia_prices) {
      for (const mapping of readyMappings) {
        const price = overrides.jumia_prices[mapping.jumia_sku];
        if (price == null) continue;
        const { error: priceUpdateError } = await supabase
          .from('jumia_product_mappings')
          .update({ jumia_price: price, updated_at: new Date().toISOString() })
          .eq('id', mapping.id)
          .eq('merchant_id', merchantId);
        if (priceUpdateError) {
          logger.error({
            message: 'Local per-variant price update failed',
            error: priceUpdateError,
          });
          return NextResponse.json(
            { error: 'Failed to update local mapping' },
            { status: 500 }
          );
        }
      }
    }

    const feedIds: string[] = [];
    const feedErrors: string[] = [];

    if (Object.hasOwn(overrides, 'is_active')) {
      await pushStatusUpdates(
        client,
        mappings,
        overrides.is_active ?? true,
        feedIds,
        feedErrors
      );
    }

    if (needsPriceUpdate && marketplaceCurrency) {
      await pushPriceUpdates(
        client,
        mappings,
        overrides,
        marketplaceCurrency,
        feedIds,
        feedErrors
      );
    }

    return NextResponse.json({
      success: feedErrors.length === 0,
      feedIds,
      ...(feedErrors.length > 0 && { errors: feedErrors }),
    });
  } catch (error) {
    logger.error({ message: 'Update Jumia Product Error', error });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to update Jumia product',
      },
      { status: 500 }
    );
  }
}
