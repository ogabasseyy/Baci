import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildGoogleAdsAnalyticsSnapshot,
  type GoogleAdsAnalyticsSpendRow,
} from '@/lib/google-ads/analytics-snapshot';
import type { Database } from '@/types/supabase';
import {
  buildSocialAdsAnalyticsSnapshot,
  SOCIAL_ADS_REPORTING_PROVIDERS,
} from './social-ads-analytics-snapshot';

export const SOCIAL_ADS_SPEND_PAGE_SIZE = 500;
export const GOOGLE_ADS_SPEND_PAGE_SIZE = 500;
const MAX_GOOGLE_ADS_SPEND_PAGES = 1000;
const MAX_SOCIAL_ADS_SPEND_PAGES = 1000;

type SocialAdsSpendRow = Pick<
  Database['public']['Tables']['merchant_ad_spend_daily']['Row'],
  | 'account_timezone'
  | 'clicks'
  | 'conversions'
  | 'currency_code'
  | 'fetched_at'
  | 'impressions'
  | 'provider'
  | 'provider_customer_id'
  | 'reach'
  | 'spend_amount_decimal'
  | 'spend_date'
>;

interface FetchAdReportingSnapshotsOptions {
  endDate: string;
  merchantId: string;
  startDate: string;
  supabase: SupabaseClient<Database>;
}

interface FetchSocialAdsSpendOptions {
  endDate: string;
  merchantId: string;
  startDate: string;
  supabase: SupabaseClient<Database>;
}

interface FetchGoogleAdsSpendOptions extends FetchSocialAdsSpendOptions {
  customerId: string | null;
}

async function fetchGoogleAdsSpendRows({
  customerId,
  endDate,
  merchantId,
  startDate,
  supabase,
}: FetchGoogleAdsSpendOptions): Promise<{
  data: GoogleAdsAnalyticsSpendRow[];
  error: unknown;
}> {
  if (!customerId) return { data: [], error: null };
  const rows: GoogleAdsAnalyticsSpendRow[] = [];

  for (let page = 0; page < MAX_GOOGLE_ADS_SPEND_PAGES; page += 1) {
    const { data, error } = await supabase
      .from('merchant_ad_spend_daily')
      .select(
        'provider_customer_id, spend_date, currency_code, spend_micros, impressions, clicks, conversions, fetched_at'
      )
      .eq('merchant_id', merchantId)
      .eq('provider', 'google_ads')
      .eq('provider_customer_id', customerId)
      .gte('spend_date', startDate)
      .lte('spend_date', endDate)
      .order('spend_date', { ascending: true })
      .range(
        page * GOOGLE_ADS_SPEND_PAGE_SIZE,
        page * GOOGLE_ADS_SPEND_PAGE_SIZE + GOOGLE_ADS_SPEND_PAGE_SIZE - 1
      );

    if (error) return { data: [], error };
    const pageRows = (data ?? []) as GoogleAdsAnalyticsSpendRow[];
    rows.push(...pageRows);
    if (pageRows.length < GOOGLE_ADS_SPEND_PAGE_SIZE) {
      return { data: rows, error: null };
    }
  }

  return {
    data: [],
    error: new Error('GOOGLE_ADS_SPEND_PAGINATION_LIMIT'),
  };
}

async function fetchSocialAdsSpendRows({
  endDate,
  merchantId,
  startDate,
  supabase,
}: FetchSocialAdsSpendOptions): Promise<{
  data: SocialAdsSpendRow[];
  error: unknown;
}> {
  const rows: SocialAdsSpendRow[] = [];

  for (let page = 0; page < MAX_SOCIAL_ADS_SPEND_PAGES; page += 1) {
    const { data, error } = await supabase
      .from('merchant_ad_spend_daily')
      .select(
        'provider, provider_customer_id, spend_date, currency_code, spend_amount_decimal, impressions, clicks, conversions, reach, account_timezone, fetched_at'
      )
      .eq('merchant_id', merchantId)
      .in('provider', [...SOCIAL_ADS_REPORTING_PROVIDERS])
      .gte('spend_date', startDate)
      .lte('spend_date', endDate)
      .order('spend_date', { ascending: true })
      .order('provider', { ascending: true })
      .order('provider_customer_id', { ascending: true })
      .order('currency_code', { ascending: true })
      .range(
        page * SOCIAL_ADS_SPEND_PAGE_SIZE,
        page * SOCIAL_ADS_SPEND_PAGE_SIZE + SOCIAL_ADS_SPEND_PAGE_SIZE - 1
      );

    if (error) {
      return { data: [], error };
    }

    const pageRows = (data ?? []) as SocialAdsSpendRow[];
    rows.push(...pageRows);
    if (pageRows.length < SOCIAL_ADS_SPEND_PAGE_SIZE) {
      return { data: rows, error: null };
    }
  }

  return {
    data: [],
    error: new Error('SOCIAL_ADS_SPEND_PAGINATION_LIMIT'),
  };
}

export async function fetchAdReportingSnapshots({
  endDate,
  merchantId,
  startDate,
  supabase,
}: FetchAdReportingSnapshotsOptions) {
  const googleConnectionPromise = supabase
    .from('merchant_ad_connections')
    .select(
      'status, provider_customer_id, last_synced_at, last_synced_start_date, last_synced_end_date'
    )
    .eq('merchant_id', merchantId)
    .eq('provider', 'google_ads')
    .maybeSingle();
  const [
    { data: googleConnection, error: googleConnectionError },
    { data: socialConnections, error: socialConnectionError },
    { data: socialRows, error: socialRowsError },
  ] = await Promise.all([
    googleConnectionPromise,
    supabase
      .from('merchant_ad_connections')
      .select(
        'provider, status, provider_customer_id, provider_account_label, account_timezone, last_synced_at, last_synced_start_date, last_synced_end_date, token_expires_at'
      )
      .eq('merchant_id', merchantId)
      .in('provider', [...SOCIAL_ADS_REPORTING_PROVIDERS]),
    fetchSocialAdsSpendRows({ endDate, merchantId, startDate, supabase }),
  ]);
  const { data: googleRows, error: googleRowsError } =
    await fetchGoogleAdsSpendRows({
      customerId: googleConnection?.provider_customer_id ?? null,
      endDate,
      merchantId,
      startDate,
      supabase,
    });

  return {
    googleAds: buildGoogleAdsAnalyticsSnapshot(
      googleConnection,
      googleRows ?? [],
      {
        connectionReadFailed: Boolean(googleConnectionError),
        endDate,
        spendReadFailed: Boolean(googleRowsError),
        startDate,
      }
    ),
    socialAds: buildSocialAdsAnalyticsSnapshot({
      connectionReadFailed: Boolean(socialConnectionError),
      connections: socialConnections ?? [],
      endDate,
      spendReadFailed: Boolean(socialRowsError),
      spendRows: socialRows ?? [],
      startDate,
    }),
  };
}
