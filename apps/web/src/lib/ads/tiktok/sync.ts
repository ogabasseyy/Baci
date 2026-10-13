import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  markAdsSyncStarted,
  markFinalAdsSync,
} from '@/lib/ads/mark-final-ads-sync';
import type { AdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import { tiktokAdsSyncRequestSchema } from '@/schemas/tiktok-ads';
import { resolveTikTokAdsAccessToken } from './access-token';
import { getTikTokAdsConfig } from './config';
import {
  TIKTOK_ADS_LATENCY_LABEL,
  TIKTOK_ADS_MAX_SYNC_DAYS,
  TIKTOK_ADS_PROVIDER,
} from './constants';
import {
  fetchTikTokAdsDailyReport,
  listTikTokAdsAccounts,
  TikTokAdsProviderError,
} from './provider';

export class TikTokAdsSyncError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'TikTokAdsSyncError';
  }
}
export class TikTokAdsReauthPersistenceError extends Error {
  readonly code = 'TIKTOK_ADS_REAUTH_PERSIST_FAILED';
  constructor() {
    super('TIKTOK_ADS_REAUTH_PERSIST_FAILED');
    this.name = 'TikTokAdsReauthPersistenceError';
  }
}
const inFlightSyncs = new Map<
  string,
  Promise<{ accountId: string; rowsWritten: number }>
>();

export function tiktokAdsDateChunks(
  startDate: string,
  endDate: string
): Array<{ startDate: string; endDate: string }> {
  const chunks: Array<{ startDate: string; endDate: string }> = [];
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    const chunkStart = cursor.toISOString().slice(0, 10);
    const chunkEndDate = new Date(cursor);
    chunkEndDate.setUTCDate(
      chunkEndDate.getUTCDate() + TIKTOK_ADS_MAX_SYNC_DAYS - 1
    );
    const chunkEnd = chunkEndDate > end ? end : chunkEndDate;
    chunks.push({
      startDate: chunkStart,
      endDate: chunkEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return chunks;
}
export async function markTikTokAdsReauthRequired(input: {
  connection: {
    access_token_ciphertext: string | null;
    provider_customer_id: string | null;
    refresh_token_ciphertext?: string | null;
  };
  credentialSupabase: AdsCredentialServiceClient;
  failureCode: string;
  merchantId: string;
}): Promise<void> {
  const { error } = await input.credentialSupabase.rpc(
    'mark_merchant_ads_connection_reauth_if_current',
    {
      p_access_token_ciphertext: input.connection.access_token_ciphertext,
      p_merchant_id: input.merchantId,
      p_provider: TIKTOK_ADS_PROVIDER,
      p_refresh_token_ciphertext:
        input.connection.refresh_token_ciphertext ?? null,
      p_reason: input.failureCode,
    }
  );
  if (error) throw new TikTokAdsReauthPersistenceError();
  // A false result means another request already replaced these credentials.
}
function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { code?: unknown }).code === 'string'
  )
    return (error as { code: string }).code;
  return error instanceof TikTokAdsProviderError ||
    error instanceof TikTokAdsSyncError
    ? error.code
    : error instanceof Error
      ? error.message
      : 'TIKTOK_ADS_SYNC_FAILED';
}
function needsReauth(error: unknown): boolean {
  return (
    errorCode(error) === 'TIKTOK_ADS_ACCESS_REVOKED' ||
    errorCode(error) === 'TIKTOK_ADS_ACCESS_TOKEN_DECRYPT_FAILED' ||
    errorCode(error) === 'TIKTOK_ADS_REAUTH_REQUIRED'
  );
}

export async function syncTikTokAdsSpendForMerchant(
  input: {
    credentialSupabase: AdsCredentialServiceClient;
    endDate: string;
    finalChunk?: boolean;
    merchantId: string;
    spendSupabase: SupabaseClient;
    startDate: string;
    syncRunId?: string;
    syncRunStartedAt?: string;
    syncWindowEndDate?: string;
    syncWindowStartDate?: string;
    supabase: SupabaseClient;
  },
  fetchImpl: typeof fetch = fetch
): Promise<{ accountId: string; rowsWritten: number }> {
  if (
    !tiktokAdsSyncRequestSchema.safeParse({
      endDate: input.endDate,
      startDate: input.startDate,
      syncRunId: input.syncRunId,
      syncRunStartedAt: input.syncRunStartedAt,
      syncWindowEndDate: input.syncWindowEndDate,
      syncWindowStartDate: input.syncWindowStartDate,
    }).success
  )
    throw new TikTokAdsSyncError('INVALID_DATE_RANGE');
  const syncRunId = input.syncRunId ?? crypto.randomUUID();
  const syncRunStartedAt = input.syncRunStartedAt ?? new Date().toISOString();
  const syncWindowStartDate = input.syncWindowStartDate ?? input.startDate;
  const syncWindowEndDate = input.syncWindowEndDate ?? input.endDate;
  const config = getTikTokAdsConfig();
  const { data, error } = await input.credentialSupabase.rpc(
    'get_merchant_ads_connection_secret',
    { p_merchant_id: input.merchantId, p_provider: TIKTOK_ADS_PROVIDER }
  );
  if (error) throw new TikTokAdsSyncError('CONNECTION_READ_FAILED');
  const connection = data?.[0];
  if (!connection?.provider_customer_id || connection.status !== 'active')
    throw new TikTokAdsSyncError('TIKTOK_ADS_ACCOUNT_NOT_SELECTED');
  const providerCustomerId = connection.provider_customer_id;
  let token: string;
  try {
    token = resolveTikTokAdsAccessToken(connection, config);
  } catch (cause) {
    if (needsReauth(cause)) {
      try {
        await markTikTokAdsReauthRequired({
          connection,
          failureCode: errorCode(cause),
          merchantId: input.merchantId,
          credentialSupabase: input.credentialSupabase,
        });
      } catch {
        throw new TikTokAdsSyncError('TIKTOK_ADS_REAUTH_PERSIST_FAILED');
      }
    }
    throw new TikTokAdsSyncError(errorCode(cause));
  }
  const key = `${input.merchantId}:${providerCustomerId}:${input.startDate}:${input.endDate}:${input.finalChunk !== false}:${syncRunId}`;
  const active = inFlightSyncs.get(key);
  if (active) return active;
  const work = (async () => {
    try {
      if (
        !(await markAdsSyncStarted({
          merchantId: input.merchantId,
          provider: TIKTOK_ADS_PROVIDER,
          providerCustomerId,
          syncRunId,
          syncRunStartedAt,
          syncWindowEndDate,
          syncWindowStartDate,
          supabase: input.supabase,
        }))
      )
        throw new TikTokAdsSyncError('SYNC_STATUS_UPDATE_FAILED');

      const accounts = await listTikTokAdsAccounts(
        {
          accessToken: token,
          appId: config.appId,
          appSecret: config.appSecret,
        },
        fetchImpl
      );
      const account = accounts.find(
        (item) => item.accountId === providerCustomerId
      );
      if (!account)
        throw new TikTokAdsSyncError('TIKTOK_ADS_ACCOUNT_NOT_ACCESSIBLE');
      const pendingRows: Record<string, unknown>[] = [];
      for (const range of tiktokAdsDateChunks(input.startDate, input.endDate)) {
        const reports = await fetchTikTokAdsDailyReport(
          {
            accessToken: token,
            accountId: account.accountId,
            currencyCode: account.currencyCode,
            timezoneName: account.timezoneName,
            ...range,
          },
          fetchImpl
        );
        const firstReport = reports[0];
        if (
          firstReport &&
          reports.some(
            (report) =>
              report.currencyCode !== firstReport.currencyCode ||
              report.timezoneName !== firstReport.timezoneName
          )
        )
          throw new TikTokAdsSyncError(
            'TIKTOK_ADS_ACCOUNT_CURRENCY_OR_TIMEZONE_MISMATCH'
          );
        const rows = reports.map((report) => ({
          account_timezone: report.timezoneName,
          attribution_metadata: {
            provider: TIKTOK_ADS_PROVIDER,
            providerConversionsLabel: 'TikTok optimization-event conversions',
            providerLatency: TIKTOK_ADS_LATENCY_LABEL,
            providerVersion: 'v1.3',
          },
          clicks: report.clicks,
          conversions: report.conversions,
          currency_code: report.currencyCode,
          fetched_at: new Date().toISOString(),
          impressions: report.impressions,
          provider_customer_id: report.accountId,
          reach: report.reach,
          spend_amount_decimal: report.spendAmountDecimal,
          spend_date: report.spendDate,
          spend_micros: '0',
        }));
        pendingRows.push(...rows);
      }
      const written = await input.spendSupabase.rpc(
        'replace_merchant_ads_spend_daily_window',
        {
          p_end_date: input.endDate,
          p_merchant_id: input.merchantId,
          p_provider: TIKTOK_ADS_PROVIDER,
          p_provider_customer_id: account.accountId,
          p_rows: pendingRows,
          p_start_date: input.startDate,
          p_sync_run_id: syncRunId,
        }
      );
      if (written.error) throw new TikTokAdsSyncError('SPEND_WRITE_FAILED');
      const rowsWritten = written.data ?? 0;
      if (
        !(await markFinalAdsSync({
          finalChunk: input.finalChunk,
          merchantId: input.merchantId,
          provider: TIKTOK_ADS_PROVIDER,
          providerCustomerId: account.accountId,
          syncRunId,
          syncWindowEndDate,
          syncWindowStartDate,
          supabase: input.supabase,
        }))
      )
        throw new TikTokAdsSyncError('SYNC_STATUS_UPDATE_FAILED');
      return { accountId: account.accountId, rowsWritten };
    } catch (cause) {
      if (needsReauth(cause)) {
        try {
          await markTikTokAdsReauthRequired({
            connection,
            failureCode: errorCode(cause),
            merchantId: input.merchantId,
            credentialSupabase: input.credentialSupabase,
          });
        } catch {
          throw new TikTokAdsSyncError('TIKTOK_ADS_REAUTH_PERSIST_FAILED');
        }
      }
      throw cause;
    }
  })();
  inFlightSyncs.set(key, work);
  try {
    return await work;
  } finally {
    inFlightSyncs.delete(key);
  }
}
