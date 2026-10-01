import { type NextRequest, NextResponse } from 'next/server';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import { fetchPaginatedSpendRows } from '@/lib/ads/spend-pagination';
import { getInclusiveAdsDateRangeDays } from '@/lib/analytics/ads-sync-limits';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import {
  googleAdsSpendQuerySchema,
  MAX_GOOGLE_ADS_SYNC_DAYS,
} from '@/schemas/google-ads';

const SPEND_SELECT =
  'provider_customer_id, spend_date, currency_code, spend_micros, impressions, clicks, conversions, fetched_at' as const;

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultDateRange(now = new Date()): {
  endDate: string;
  startDate: string;
} {
  const endDate = utcDateString(now);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 30);
  return { endDate, startDate: utcDateString(start) };
}

function nonNegativeIntegerString(value: unknown): string {
  const stringValue = String(value ?? '0');
  return /^\d+$/.test(stringValue) ? stringValue : '0';
}

function nonNegativeNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }
  const supabase = auth.supabase;

  const parsedQuery = googleAdsSpendQuerySchema.safeParse({
    customerId: request.nextUrl.searchParams.get('customerId') ?? undefined,
    endDate: request.nextUrl.searchParams.get('endDate') ?? undefined,
    startDate: request.nextUrl.searchParams.get('startDate') ?? undefined,
  });
  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsedQuery.error.flatten() },
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
  if (!hasPermission(access, 'analytics', 'view')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  const defaults = defaultDateRange();
  const startDate = parsedQuery.data.startDate ?? defaults.startDate;
  const endDate = parsedQuery.data.endDate ?? defaults.endDate;
  if (
    startDate > endDate ||
    getInclusiveAdsDateRangeDays(startDate, endDate) > MAX_GOOGLE_ADS_SYNC_DAYS
  ) {
    return NextResponse.json(
      {
        error: 'Invalid input',
        details: {
          fieldErrors: {
            endDate: [
              `Spend range cannot exceed ${MAX_GOOGLE_ADS_SYNC_DAYS} days`,
            ],
          },
          formErrors: [],
        },
      },
      { status: 400 }
    );
  }
  let customerId = parsedQuery.data.customerId;
  if (!customerId) {
    const { data: connection, error: connectionError } = await auth.supabase
      .from('merchant_ad_connections')
      .select('provider_customer_id')
      .eq('merchant_id', access.merchantId)
      .eq('provider', 'google_ads')
      .maybeSingle();
    if (connectionError) {
      return NextResponse.json(
        { error: 'Failed to read Google Ads connection' },
        { status: 500 }
      );
    }
    customerId = connection?.provider_customer_id ?? undefined;
  }

  if (!customerId) {
    return NextResponse.json({
      currencyCode: null,
      endDate,
      provider: 'google_ads',
      rows: [],
      startDate,
      totalSpend: 0,
      totalSpendMicros: '0',
    });
  }

  const { data, error } = await fetchPaginatedSpendRows((from, to) =>
    supabase
      .from('merchant_ad_spend_daily')
      .select(SPEND_SELECT)
      .eq('merchant_id', access.merchantId)
      .eq('provider', 'google_ads')
      .eq('provider_customer_id', customerId)
      .gte('spend_date', startDate)
      .lte('spend_date', endDate)
      .order('spend_date', { ascending: true })
      .range(from, to)
  );
  if (error) {
    return NextResponse.json(
      { error: 'Failed to read Google Ads spend' },
      { status: 500 }
    );
  }

  const rows = (data ?? []).map((row) => {
    const spendMicros = nonNegativeIntegerString(row.spend_micros);
    return {
      clicks: nonNegativeNumber(row.clicks),
      conversions: nonNegativeNumber(row.conversions),
      currencyCode: row.currency_code,
      customerId: row.provider_customer_id,
      date: row.spend_date,
      fetchedAt: row.fetched_at,
      impressions: nonNegativeNumber(row.impressions),
      spend: Number(spendMicros) / 1_000_000,
      spendMicros,
    };
  });

  let totalSpendMicros = 0n;
  for (const row of rows) {
    totalSpendMicros += BigInt(row.spendMicros);
  }

  return NextResponse.json({
    currencyCode: rows[0]?.currencyCode ?? null,
    endDate,
    provider: 'google_ads',
    rows,
    startDate,
    totalSpend: Number(totalSpendMicros) / 1_000_000,
    totalSpendMicros: totalSpendMicros.toString(),
  });
}
