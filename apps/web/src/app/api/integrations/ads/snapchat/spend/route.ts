import { type NextRequest, NextResponse } from 'next/server';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import { SNAPCHAT_ADS_PROVIDER } from '@/lib/ads/snapchat/constants';
import { snapchatAdsLocalDate } from '@/lib/ads/snapchat/provider';
import { fetchPaginatedSpendRows } from '@/lib/ads/spend-pagination';
import { getInclusiveAdsDateRangeDays } from '@/lib/analytics/ads-sync-limits';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import {
  MAX_SNAPCHAT_ADS_SYNC_DAYS,
  snapchatAdsSpendQuerySchema,
} from '@/schemas/snapchat-ads';

const SELECT =
  'provider_customer_id, spend_date, currency_code, spend_amount_decimal, spend_micros, impressions, clicks, conversions, account_timezone, attribution_metadata, fetched_at' as const;
function dates(timezone: string, now = new Date()) {
  const endDate = snapchatAdsLocalDate(now.getTime(), timezone);
  const start = new Date(`${endDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 30);
  return { endDate, startDate: start.toISOString().slice(0, 10) };
}
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  const supabase = auth.supabase;
  const parsed = snapchatAdsSpendQuerySchema.safeParse({
    accountId: request.nextUrl.searchParams.get('accountId') ?? undefined,
    endDate: request.nextUrl.searchParams.get('endDate') ?? undefined,
    startDate: request.nextUrl.searchParams.get('startDate') ?? undefined,
  });
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
  if (!hasPermission(access, 'analytics', 'view'))
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  const connection = await auth.supabase
    .from('merchant_ad_connections')
    .select('account_timezone, provider_customer_id')
    .eq('merchant_id', access.merchantId)
    .eq('provider', SNAPCHAT_ADS_PROVIDER)
    .eq('status', 'active')
    .maybeSingle();
  if (connection.error)
    return NextResponse.json(
      { error: 'Failed to read Snapchat Ads connection status' },
      { status: 500 }
    );
  const defaults = dates(connection.data?.account_timezone ?? 'UTC');
  const startDate = parsed.data.startDate ?? defaults.startDate;
  const endDate = parsed.data.endDate ?? defaults.endDate;
  if (
    startDate > endDate ||
    getInclusiveAdsDateRangeDays(startDate, endDate) >
      MAX_SNAPCHAT_ADS_SYNC_DAYS
  )
    return NextResponse.json(
      {
        error: 'Invalid input',
        details: {
          fieldErrors: {
            endDate: [
              `Spend range cannot exceed ${MAX_SNAPCHAT_ADS_SYNC_DAYS} days`,
            ],
          },
          formErrors: [],
        },
      },
      { status: 400 }
    );
  const accountId =
    parsed.data.accountId ?? connection.data?.provider_customer_id ?? undefined;
  if (!accountId)
    return NextResponse.json({
      currencyCode: null,
      endDate,
      provider: SNAPCHAT_ADS_PROVIDER,
      rows: [],
      startDate,
    });
  const { data, error } = await fetchPaginatedSpendRows((from, to) =>
    supabase
      .from('merchant_ad_spend_daily')
      .select(SELECT)
      .eq('merchant_id', access.merchantId)
      .eq('provider', SNAPCHAT_ADS_PROVIDER)
      .gte('spend_date', startDate)
      .lte('spend_date', endDate)
      .eq('provider_customer_id', accountId)
      .order('spend_date', { ascending: true })
      .range(from, to)
  );
  if (error)
    return NextResponse.json(
      { error: 'Failed to read Snapchat Ads spend' },
      { status: 500 }
    );
  const rows = (data ?? []).map((row) => ({
    accountId: row.provider_customer_id,
    accountTimezone: row.account_timezone,
    attribution: row.attribution_metadata,
    clicks: row.clicks,
    clicksLabel: 'Swipe Ups',
    conversions: row.conversions,
    conversionsLabel: 'Snapchat-attributed purchases',
    currencyCode: row.currency_code,
    date: row.spend_date,
    fetchedAt: row.fetched_at,
    impressions: row.impressions,
    spendAmountDecimal: row.spend_amount_decimal,
    spendMicros: row.spend_micros,
  }));
  return NextResponse.json({
    currencyCode: rows[0]?.currencyCode ?? null,
    endDate,
    provider: SNAPCHAT_ADS_PROVIDER,
    rows,
    startDate,
  });
}
