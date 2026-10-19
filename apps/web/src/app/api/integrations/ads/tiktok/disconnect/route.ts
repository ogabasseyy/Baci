import { type NextRequest, NextResponse } from 'next/server';
import { invalidateAdsAnalyticsCache } from '@/lib/ads/analytics-cache';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import { createAdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import { TIKTOK_ADS_PROVIDER } from '@/lib/ads/tiktok/constants';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';

async function disconnect(request: NextRequest) {
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
  const credentialSupabase = createAdsCredentialServiceClient();
  const { error } = await credentialSupabase.rpc(
    'delete_merchant_ads_connection',
    {
      p_merchant_id: access.merchantId,
      p_provider: TIKTOK_ADS_PROVIDER,
    }
  );
  if (error) {
    return NextResponse.json(
      { error: 'Failed to disconnect TikTok Ads' },
      { status: 500 }
    );
  }
  invalidateAdsAnalyticsCache(access.merchantId);
  return NextResponse.json({ connected: false });
}
export function DELETE(request: NextRequest) {
  return disconnect(request);
}
export function POST(request: NextRequest) {
  return disconnect(request);
}
