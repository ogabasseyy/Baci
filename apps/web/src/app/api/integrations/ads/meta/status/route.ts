import { type NextRequest, NextResponse } from 'next/server';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';

const STATUS_SELECT =
  'provider, status, provider_customer_id, provider_account_label, account_timezone, token_expires_at, last_synced_at, created_at, updated_at' as const;

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
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
  if (
    !hasPermission(access, 'analytics', 'view') &&
    !hasPermission(access, 'integrations', 'view')
  )
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  const { data, error } = await auth.supabase
    .from('merchant_ad_connections')
    .select(STATUS_SELECT)
    .eq('merchant_id', access.merchantId)
    .eq('provider', 'meta_ads')
    .maybeSingle();
  if (error)
    return NextResponse.json(
      { error: 'Failed to read Meta Ads connection status' },
      { status: 500 }
    );
  const tokenExpired =
    data?.status === 'active' &&
    (!data.token_expires_at ||
      Date.parse(data.token_expires_at) <= Date.now() + 60_000);
  const reportedStatus = tokenExpired ? 'reauth_required' : data?.status;
  return NextResponse.json({
    connected: data?.status === 'active' && !tokenExpired,
    connection: data
      ? {
          accountTimezone: data.account_timezone,
          createdAt: data.created_at,
          lastSyncedAt: data.last_synced_at,
          needsAccountSelection:
            reportedStatus === 'active' && !data.provider_customer_id,
          provider: data.provider,
          providerAccountId: data.provider_customer_id,
          providerAccountLabel: data.provider_account_label,
          status: reportedStatus,
          tokenExpiresAt: data.token_expires_at,
          updatedAt: data.updated_at,
        }
      : null,
  });
}
