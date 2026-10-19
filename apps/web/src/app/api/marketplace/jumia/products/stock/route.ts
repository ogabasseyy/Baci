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
import { reconcileJumiaStockFeeds } from '@/lib/jumia/reconcile-jumia-stock-feeds';
import { updateJumiaStockTracking } from '@/lib/jumia/update-jumia-stock-tracking';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { createClient } from '@/lib/supabase/server';
import { resolveJumiaStockUpdates } from './resolve-jumia-stock-updates';

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

    // Settle previously accepted stock feeds first: a later rejection resets
    // the cursor so the mapping is retried instead of skipped forever.
    const reconciliation = await reconcileJumiaStockFeeds(
      supabase,
      jumiaClient,
      { mappings }
    );
    if (reconciliation.failures > 0) {
      console.error(
        '[Jumia Stock Sync] Stock feed reconciliation failed for',
        reconciliation.failures,
        'mapping(s)'
      );
    }

    const { pushReady, skipped: initialSkipped } =
      getPushReadyJumiaStockMappings(mappings);

    if (pushReady.length === 0) {
      return NextResponse.json({
        success: true,
        updated: 0,
        skipped: initialSkipped,
        message: 'No push-ready mappings (missing seller SKU or product ID)',
      });
    }

    const {
      stockUpdates,
      skipped: resolutionSkipped,
      fetchErrors,
    } = await resolveJumiaStockUpdates(supabase, merchantId, pushReady);
    const skipped = initialSkipped + resolutionSkipped;

    if (stockUpdates.length === 0) {
      if (fetchErrors > 0 || reconciliation.failures > 0) {
        // Nothing was pushed: reporting "up to date" would mask the failure.
        return NextResponse.json({
          success: false,
          updated: 0,
          skipped,
          ...(fetchErrors > 0 && { fetchErrors }),
          ...(reconciliation.failures > 0 && {
            reconciliationFailures: reconciliation.failures,
          }),
          message:
            'Stock sync could not complete for some products; nothing was pushed',
        });
      }
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

    const { trackingFailures } = await updateJumiaStockTracking(supabase, {
      updates: stockUpdates.map((update) => ({
        mappingId: update.mappingId,
        stock: update.stock,
      })),
      feedId,
    });

    if (trackingFailures > 0) {
      console.error(
        '[Jumia Stock Sync] Stock tracking update failed for',
        trackingFailures,
        'mapping(s)'
      );
    }

    return NextResponse.json({
      success: true,
      updated: stockUpdates.length,
      skipped,
      feedId,
      ...(trackingFailures > 0 && { trackingFailures }),
      ...(fetchErrors > 0 && { fetchErrors: fetchErrors }),
      ...(reconciliation.failures > 0 && {
        reconciliationFailures: reconciliation.failures,
      }),
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
