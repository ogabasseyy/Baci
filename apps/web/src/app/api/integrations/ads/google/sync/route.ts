import { type NextRequest, NextResponse } from 'next/server';
import { invalidateAdsAnalyticsCache } from '@/lib/ads/analytics-cache';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import { resolveAdsSyncRun } from '@/lib/ads/resolve-sync-run';
import { createAdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import { createAdsSpendServiceClient } from '@/lib/ads/server-spend-client';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { GoogleAdsConfigError } from '@/lib/google-ads/config';
import { GoogleAdsProviderError } from '@/lib/google-ads/provider';
import {
  GoogleAdsSyncError,
  syncGoogleAdsSpendForMerchant,
} from '@/lib/google-ads/sync';
import { googleAdsSyncRequestSchema } from '@/schemas/google-ads';

export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }
  const parsed = googleAdsSyncRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const merchant = await resolveAdsMerchantAccess({
    request,
    supabase: auth.supabase,
    userId: auth.user.id,
  });
  if (merchant.response) return merchant.response;
  const access = merchant.access;
  if (!access) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }
  if (!hasPermission(access, 'integrations', 'manage')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }
  const syncRun = await resolveAdsSyncRun({
    merchantId: access.merchantId,
    provider: 'google_ads',
    requestedSyncRunId: parsed.data.syncRunId,
    supabase: auth.supabase,
  });
  if (!syncRun) {
    return NextResponse.json(
      { error: 'SYNC_RUN_NOT_CURRENT' },
      { status: 409 }
    );
  }
  try {
    // Credential reads/refreshes are service-role-only. Construct the
    // dedicated client only after the request has passed auth, merchant, and
    // permission checks; the spend writer has its own narrowly scoped service
    // client.
    const credentialSupabase = createAdsCredentialServiceClient();
    const result = await syncGoogleAdsSpendForMerchant({
      endDate: parsed.data.endDate,
      finalChunk: parsed.data.finalChunk,
      merchantId: access.merchantId,
      credentialSupabase,
      spendSupabase: createAdsSpendServiceClient(),
      startDate: parsed.data.startDate,
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
    if (error instanceof GoogleAdsConfigError) {
      return NextResponse.json(
        { error: 'Google Ads integration unavailable' },
        { status: 503 }
      );
    }
    if (error instanceof GoogleAdsSyncError) {
      const status =
        error.code === 'GOOGLE_ADS_CUSTOMER_NOT_SELECTED' ? 409 : 502;
      return NextResponse.json({ error: error.code }, { status });
    }
    if (error instanceof GoogleAdsProviderError) {
      return NextResponse.json({ error: error.code }, { status: 502 });
    }
    return NextResponse.json(
      { error: 'Google Ads sync failed' },
      { status: 502 }
    );
  }
}
