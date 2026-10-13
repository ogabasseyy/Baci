import { type NextRequest, NextResponse } from 'next/server';
import { invalidateAdsAnalyticsCache } from '@/lib/ads/analytics-cache';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import { resolveAdsSyncRun } from '@/lib/ads/resolve-sync-run';
import { createAdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import { createAdsSpendServiceClient } from '@/lib/ads/server-spend-client';
import { TikTokAdsConfigError } from '@/lib/ads/tiktok/config';
import { TikTokAdsProviderError } from '@/lib/ads/tiktok/provider';
import {
  syncTikTokAdsSpendForMerchant,
  TikTokAdsSyncError,
} from '@/lib/ads/tiktok/sync';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { tiktokAdsSyncRequestSchema } from '@/schemas/tiktok-ads';
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
  const parsed = tiktokAdsSyncRequestSchema.safeParse(body);
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
    provider: 'tiktok_ads',
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
    const result = await syncTikTokAdsSpendForMerchant({
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
    if (error instanceof TikTokAdsConfigError)
      return NextResponse.json(
        { error: 'TikTok Ads integration unavailable' },
        { status: 503 }
      );
    if (error instanceof TikTokAdsSyncError)
      return NextResponse.json(
        { error: error.code },
        { status: error.code === 'TIKTOK_ADS_ACCOUNT_NOT_SELECTED' ? 409 : 502 }
      );
    if (error instanceof TikTokAdsProviderError)
      return NextResponse.json({ error: error.code }, { status: 502 });
    return NextResponse.json(
      { error: 'TikTok Ads sync failed' },
      { status: 502 }
    );
  }
}
