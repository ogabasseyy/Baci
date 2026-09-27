/**
 * Reconcile pending Jumia product feeds with local mappings.
 *
 * Jumia product creation is asynchronous: a successful create request only
 * gives us a feed ID. A mapping becomes stock-syncable only after the feed
 * item is accepted and Jumia assigns a product ID.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  authenticateApiRequest,
  getMerchantIdForApiUser,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  JumiaApiError,
  JumiaClient,
  jumiaErrorResponse,
} from '@/lib/jumia/client';
import { getFeedStatus } from '@/lib/jumia/feeds';
import {
  MAX_FEEDS_PER_REQUEST,
  type PendingFeedMapping,
  selectPendingFeedIds,
} from '@/lib/jumia/jumia-feed-reconciliation-batch';
import {
  isAcceptedFeedStatus,
  isFailedFeedStatus,
} from '@/lib/jumia/jumia-feed-status-normalization';
import { logger } from '@/lib/logger';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { jumiaFeedStatusQuerySchema } from '@/schemas/jumia-feed-status';
import { AMBIGUOUS_JUMIA_EXPORT_ERROR } from '../export/mark-ambiguous-jumia-export';
import { handleJumiaFeedLookupFailure } from './handle-jumia-feed-lookup-failure';
import { handleJumiaFeedProcessingFailure } from './handle-jumia-feed-processing-failure';
import { jumiaFeedReconciliation } from './jumia-feed-reconciliation';
import { loadPendingFeedMappings } from './load-pending-feed-mappings';

type PendingMapping = PendingFeedMapping;
export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return (
      response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }
  const parsedQuery = jumiaFeedStatusQuerySchema.safeParse({
    integrationId: new URL(request.url).searchParams.get('integrationId'),
  });
  if (!parsedQuery.success) {
    return NextResponse.json(
      {
        error: 'Invalid integrationId',
        details: z.flattenError(parsedQuery.error),
      },
      { status: 400 }
    );
  }
  const merchantId = await getMerchantIdForApiUser(auth.supabase);
  if (!merchantId) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }
  const access = await getUserAccess(auth.supabase);
  if (!access || !hasPermission(access, 'integrations', 'manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const featureGateResponse = await requireMerchantFeatureAccess(
    auth.supabase,
    merchantId,
    'marketplace_sync'
  );
  if (featureGateResponse) return featureGateResponse;
  let jumia: JumiaClient;
  try {
    jumia = await JumiaClient.forIntegration(
      auth.supabase,
      merchantId,
      parsedQuery.data.integrationId
    );
  } catch (error) {
    if (error instanceof JumiaApiError) return jumiaErrorResponse(error);
    logger.error({
      message: 'Failed to initialize Jumia feed status client',
      error,
    });
    return NextResponse.json(
      { error: 'Failed to initialize Jumia client' },
      { status: 502 }
    );
  }
  const { mappings, error: mappingsError } = await loadPendingFeedMappings(
    auth.supabase,
    merchantId,
    jumia.shopId,
    jumia.marketplaceKey
  );

  if (mappingsError) {
    logger.error({
      message: 'Failed to load pending Jumia mappings',
      error: mappingsError,
    });
    return NextResponse.json(
      { error: 'Failed to load pending product feeds' },
      { status: 500 }
    );
  }
  const pending = mappings as PendingMapping[];
  const manualResolutionRequired = pending
    .filter(
      (mapping) =>
        !mapping.last_feed_id &&
        mapping.sync_error === AMBIGUOUS_JUMIA_EXPORT_ERROR
    )
    .map((mapping) => ({
      mappingId: mapping.id,
      sellerSku: mapping.jumia_seller_sku,
    }));
  const feedIds = selectPendingFeedIds(pending, MAX_FEEDS_PER_REQUEST);
  const feedResults: Array<{
    feedId: string;
    status: string;
    completed: number;
    failed: number;
  }> = [];
  let updated = 0;
  let failed = 0;
  for (const feedId of feedIds) {
    const mappingsForFeed = pending.filter(
      (mapping) => mapping.last_feed_id === feedId
    );
    let feedLookupCompleted = false;
    try {
      const feed = await getFeedStatus(jumia, feedId);
      feedLookupCompleted = true;
      feedResults.push({
        feedId,
        status: feed.status,
        completed: feed.completed,
        failed: feed.failed,
      });

      const processedMappingIds = new Set<string>();
      if (
        feed.feedItems.length === 0 &&
        (feed.failed > 0 || isFailedFeedStatus(feed.status))
      ) {
        const marked = await jumiaFeedReconciliation.markMappingsAsFeedError(
          auth.supabase,
          merchantId,
          mappingsForFeed,
          'Jumia rejected this product feed'
        );
        failed += marked;
        continue;
      }

      for (const item of feed.feedItems) {
        const mapping = jumiaFeedReconciliation.findMappingForFeedItem(
          mappingsForFeed.filter(
            (candidate) => !processedMappingIds.has(candidate.id)
          ),
          item.sellerSKU,
          feed.feedItems.length
        );
        if (!mapping || processedMappingIds.has(mapping.id)) continue;
        processedMappingIds.add(mapping.id);

        const accepted = isAcceptedFeedStatus(item.status);
        const rejected = isFailedFeedStatus(item.status);
        if (!accepted && !rejected) continue;

        const acceptedWithoutProductId = accepted && !item.productSid;
        const update =
          accepted && !acceptedWithoutProductId
            ? {
                sync_status: 'synced',
                jumia_product_id: item.productSid,
                jumia_seller_sku: item.sellerSKU,
                sync_error: null,
                last_synced_at: new Date().toISOString(),
              }
            : acceptedWithoutProductId
              ? {
                  sync_status: 'pending',
                  sync_error: AMBIGUOUS_JUMIA_EXPORT_ERROR,
                  last_feed_id: null,
                  last_synced_at: new Date().toISOString(),
                }
              : {
                  sync_status: 'error',
                  sync_error:
                    item.errorMessage ??
                    item.errors?.globalMessages?.join('; ') ??
                    'Jumia rejected this product',
                  last_synced_at: new Date().toISOString(),
                };
        const { error: updateError } = await auth.supabase
          .from('jumia_product_mappings')
          .update(update)
          .eq('id', mapping.id)
          .eq('merchant_id', merchantId);
        if (updateError) {
          logger.error({
            message: 'Failed to reconcile Jumia feed item',
            error: updateError,
          });
          return NextResponse.json(
            { error: 'Failed to reconcile Jumia feed item' },
            { status: 500 }
          );
        }
        if (accepted && !acceptedWithoutProductId) updated++;
        else if (acceptedWithoutProductId) {
          manualResolutionRequired.push({
            mappingId: mapping.id,
            sellerSku: mapping.jumia_seller_sku,
          });
        } else failed++;
      }
      const unmatchedMappings = mappingsForFeed.filter(
        (mapping) => !processedMappingIds.has(mapping.id)
      );
      if (
        unmatchedMappings.length > 0 &&
        (isAcceptedFeedStatus(feed.status) || isFailedFeedStatus(feed.status))
      ) {
        manualResolutionRequired.push(
          ...(await jumiaFeedReconciliation.markMappingsAsPendingForManualResolution(
            auth.supabase,
            merchantId,
            unmatchedMappings,
            AMBIGUOUS_JUMIA_EXPORT_ERROR
          ))
        );
      }
      const { error: cursorError } = await auth.supabase
        .from('jumia_product_mappings')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('merchant_id', merchantId)
        .eq('last_feed_id', feedId)
        .eq('sync_status', 'pending');
      if (cursorError) {
        logger.error({
          message: 'Failed to advance Jumia feed reconciliation cursor',
          error: cursorError,
          feed_id: feedId,
        });
        return NextResponse.json(
          { error: 'Failed to advance Jumia feed reconciliation cursor' },
          { status: 500 }
        );
      }
    } catch (error) {
      if (!feedLookupCompleted) {
        const lookupFailure = await handleJumiaFeedLookupFailure({
          error,
          feedId,
          mappingsForFeed,
          merchantId,
          supabase: auth.supabase,
        });
        if (lookupFailure.kind === 'response') return lookupFailure.response;
        failed += lookupFailure.failed;
        feedResults.push({
          feedId,
          status: lookupFailure.status,
          completed: 0,
          failed: lookupFailure.feedFailed,
        });
        for (const preserved of lookupFailure.preservedForManualResolution) {
          manualResolutionRequired.push(preserved);
        }
        continue;
      }
      return handleJumiaFeedProcessingFailure({ error, feedId });
    }
  }

  return NextResponse.json({
    success: true,
    checked: feedIds.length,
    updated,
    failed,
    pending: pending.length - updated - failed,
    feeds: feedResults,
    manualResolutionRequired,
  });
}
