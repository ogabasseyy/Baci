import { type NextRequest, NextResponse } from 'next/server';
import { invalidateAdsAnalyticsCache } from '@/lib/ads/analytics-cache';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import { resolveAdsSyncRun } from '@/lib/ads/resolve-sync-run';
import { createAdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import { createAdsSpendServiceClient } from '@/lib/ads/server-spend-client';
import { SnapchatAdsConfigError } from '@/lib/ads/snapchat/config';
import { SnapchatAdsProviderError } from '@/lib/ads/snapchat/provider';
import {
  SnapchatAdsSyncError,
  syncSnapchatAdsSpendForMerchant,
} from '@/lib/ads/snapchat/sync';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { snapchatAdsSyncRequestSchema } from '@/schemas/snapchat-ads';
export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }
  const parsed = snapchatAdsSyncRequestSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    );
  const merchant = await resolveAdsMerchantAccess({
    request,
    supabase: auth.supabase,
    userId: auth.user.id,
  });
  if (merchant.response) return merchant.response;
  const access = merchant.access;
  if (!access)
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  if (!hasPermission(access, 'integrations', 'manage'))
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  const syncRun = await resolveAdsSyncRun({
    merchantId: access.merchantId,
    provider: 'snapchat_ads',
    requestedSyncRunId: parsed.data.syncRunId,
    supabase: auth.supabase,
  });
  if (!syncRun)
    return NextResponse.json(
      { error: 'SYNC_RUN_NOT_CURRENT' },
      { status: 409 }
    );
  const credentialSupabase = createAdsCredentialServiceClient();
  try {
    const result = await syncSnapchatAdsSpendForMerchant({
      ...parsed.data,
      credentialSupabase,
      merchantId: access.merchantId,
      spendSupabase: createAdsSpendServiceClient(),
      syncRunId: syncRun.syncRunId,
      syncRunStartedAt: syncRun.syncRunStartedAt,
      syncWindowEndDate: parsed.data.syncWindowEndDate,
      syncWindowStartDate: parsed.data.syncWindowStartDate,
      supabase: auth.supabase,
    });
    if (parsed.data.finalChunk) {
      invalidateAdsAnalyticsCache(access.merchantId);
    }
    return NextResponse.json({
      ...result,
      syncRunId: syncRun.syncRunId,
      syncRunStartedAt: syncRun.syncRunStartedAt,
      synced: true,
    });
  } catch (error) {
    if (error instanceof SnapchatAdsConfigError)
      return NextResponse.json(
        { error: 'Snapchat Ads integration unavailable' },
        { status: 503 }
      );
    if (error instanceof SnapchatAdsSyncError)
      return NextResponse.json(
        { error: error.code },
        {
          status:
            error.code === 'SNAPCHAT_ADS_ACCOUNT_NOT_SELECTED' ? 409 : 502,
        }
      );
    return NextResponse.json(
      {
        error:
          error instanceof SnapchatAdsProviderError
            ? error.code
            : 'Snapchat Ads sync failed',
      },
      { status: 502 }
    );
  }
}
