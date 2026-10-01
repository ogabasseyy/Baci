import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  markAdsSyncStarted,
  markFinalAdsSync,
} from '@/lib/ads/mark-final-ads-sync';
import type { AdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import { snapchatAdsSyncRequestSchema } from '@/schemas/snapchat-ads';
import {
  getSnapchatAdsUsableGrant,
  SnapchatAdsTokenRefreshError,
} from './access-token';
import { getSnapchatAdsConfig } from './config';
import {
  SNAPCHAT_ADS_PROVIDER,
  SNAPCHAT_ADS_TRAILING_SYNC_DAYS,
} from './constants';
import {
  fetchSnapchatAdsDailyReport,
  listSnapchatAdsAccounts,
  snapchatAdsLocalDate,
} from './provider';

export class SnapchatAdsSyncError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SnapchatAdsSyncError';
  }
}
const activeSyncs = new Map<
  string,
  Promise<{ accountId: string; rowsWritten: number }>
>();

export function snapchatAdsTrailingStartDate(
  startDate: string,
  endDate: string,
  timezone: string,
  now = new Date()
): string {
  const today = snapchatAdsLocalDate(now.getTime(), timezone);
  if (endDate < today) return startDate;
  const trailing = new Date(`${endDate}T00:00:00.000Z`);
  trailing.setUTCDate(trailing.getUTCDate() - SNAPCHAT_ADS_TRAILING_SYNC_DAYS);
  return trailing.toISOString().slice(0, 10) < startDate
    ? trailing.toISOString().slice(0, 10)
    : startDate;
}
function codeOf(error: unknown): string {
  return error &&
    typeof error === 'object' &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : error instanceof Error
      ? error.message
      : 'SNAPCHAT_ADS_SYNC_FAILED';
}
export async function markSnapchatAdsReauthRequired(input: {
  connection: {
    access_token_ciphertext: string | null;
    provider_customer_id: string | null;
    refresh_token_ciphertext: string | null;
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
      p_provider: SNAPCHAT_ADS_PROVIDER,
      p_refresh_token_ciphertext: input.connection.refresh_token_ciphertext,
      p_reason: input.failureCode,
    }
  );
  if (error)
    throw new SnapchatAdsSyncError('SNAPCHAT_ADS_REAUTH_PERSIST_FAILED');
  // A false result means a concurrent refresh already replaced the token.
}
export async function syncSnapchatAdsSpendForMerchant(
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
    !snapchatAdsSyncRequestSchema.safeParse({
      endDate: input.endDate,
      finalChunk: input.finalChunk,
      startDate: input.startDate,
      syncRunId: input.syncRunId,
      syncRunStartedAt: input.syncRunStartedAt,
      syncWindowEndDate: input.syncWindowEndDate,
      syncWindowStartDate: input.syncWindowStartDate,
    }).success
  )
    throw new SnapchatAdsSyncError('INVALID_DATE_RANGE');
  const syncRunId = input.syncRunId ?? crypto.randomUUID();
  const syncRunStartedAt = input.syncRunStartedAt ?? new Date().toISOString();
  const syncWindowStartDate = input.syncWindowStartDate ?? input.startDate;
  const syncWindowEndDate = input.syncWindowEndDate ?? input.endDate;
  const config = getSnapchatAdsConfig();
  const read = await input.credentialSupabase.rpc(
    'get_merchant_ads_connection_secret',
    {
      p_merchant_id: input.merchantId,
      p_provider: SNAPCHAT_ADS_PROVIDER,
    }
  );
  if (read.error) throw new SnapchatAdsSyncError('CONNECTION_READ_FAILED');
  let connection = read.data?.[0];
  if (!connection?.provider_customer_id || connection.status !== 'active')
    throw new SnapchatAdsSyncError('SNAPCHAT_ADS_ACCOUNT_NOT_SELECTED');
  const providerCustomerId = connection.provider_customer_id;
  let token: string;
  try {
    const usableGrant = await getSnapchatAdsUsableGrant({
      config,
      connection,
      credentialSupabase: input.credentialSupabase,
      merchantId: input.merchantId,
    });
    connection = {
      ...connection,
      access_token_ciphertext: usableGrant.accessTokenCiphertext,
      refresh_token_ciphertext: usableGrant.refreshTokenCiphertext,
      token_expires_at: usableGrant.tokenExpiresAt,
    };
    token = usableGrant.accessToken;
  } catch (error) {
    if (
      error instanceof SnapchatAdsTokenRefreshError &&
      (error.code === 'SNAPCHAT_ADS_REFRESH_REJECTED' ||
        error.code === 'SNAPCHAT_ADS_REFRESH_TOKEN_DECRYPT_FAILED')
    )
      await markSnapchatAdsReauthRequired({
        connection,
        credentialSupabase: input.credentialSupabase,
        failureCode: error.code,
        merchantId: input.merchantId,
      });
    throw new SnapchatAdsSyncError(codeOf(error));
  }
  const key = `${input.merchantId}:${providerCustomerId}:${input.startDate}:${input.endDate}:${input.finalChunk !== false}:${syncRunId}`;
  const current = activeSyncs.get(key);
  if (current) return current;
  const work = (async () => {
    try {
      if (
        !(await markAdsSyncStarted({
          merchantId: input.merchantId,
          provider: SNAPCHAT_ADS_PROVIDER,
          providerCustomerId,
          syncRunId,
          syncRunStartedAt,
          syncWindowEndDate,
          syncWindowStartDate,
          supabase: input.supabase,
        }))
      )
        throw new SnapchatAdsSyncError('SYNC_STATUS_UPDATE_FAILED');

      const account = (
        await listSnapchatAdsAccounts({ accessToken: token }, fetchImpl)
      ).find((item) => item.accountId === providerCustomerId);
      if (!account)
        throw new SnapchatAdsSyncError('SNAPCHAT_ADS_ACCOUNT_NOT_ACCESSIBLE');
      const startDate = snapchatAdsTrailingStartDate(
        input.startDate,
        input.endDate,
        account.timezoneName
      );
      const reports = await fetchSnapchatAdsDailyReport(
        {
          accessToken: token,
          accountId: account.accountId,
          currencyCode: account.currencyCode,
          endDate: input.endDate,
          startDate,
          timezoneName: account.timezoneName,
        },
        fetchImpl
      );
      if (
        reports.some(
          (report) =>
            report.currencyCode !== account.currencyCode ||
            report.timezoneName !== account.timezoneName
        )
      )
        throw new SnapchatAdsSyncError(
          'SNAPCHAT_ADS_ACCOUNT_CURRENCY_OR_TIMEZONE_MISMATCH'
        );
      const rows = reports.map((report) => ({
        account_timezone: report.timezoneName,
        attribution_metadata: {
          actionReportTime: 'conversion',
          provider: SNAPCHAT_ADS_PROVIDER,
          providerClicksLabel: 'Swipe Ups',
          providerConversionsLabel: 'Snapchat-attributed purchases',
          snapchatConversionDataProcessedEndTime:
            report.conversionDataProcessedEndTime,
          snapchatFinalizedDataEndTime: report.finalizedDataEndTime,
          snapchatSourceInterval: {
            endTime: report.sourceEndTime,
            startTime: report.sourceStartTime,
          },
          swipeUpAttributionWindow: '28_DAY',
          viewAttributionWindow: '1_DAY',
        },
        clicks: report.clicks,
        conversions: report.conversions,
        currency_code: report.currencyCode,
        fetched_at: new Date().toISOString(),
        impressions: report.impressions,
        provider_customer_id: report.accountId,
        reach: null,
        spend_amount_decimal: report.spendAmountDecimal,
        spend_date: report.spendDate,
        spend_micros: report.spendMicros,
      }));
      const written = await input.spendSupabase.rpc(
        'replace_merchant_ads_spend_daily_window',
        {
          p_end_date: input.endDate,
          p_merchant_id: input.merchantId,
          p_provider: SNAPCHAT_ADS_PROVIDER,
          p_provider_customer_id: account.accountId,
          p_rows: rows,
          p_start_date: startDate,
          p_sync_run_id: syncRunId,
        }
      );
      if (written.error) throw new SnapchatAdsSyncError('SPEND_WRITE_FAILED');
      const rowsWritten = written.data ?? 0;
      if (
        !(await markFinalAdsSync({
          finalChunk: input.finalChunk,
          merchantId: input.merchantId,
          provider: SNAPCHAT_ADS_PROVIDER,
          providerCustomerId: account.accountId,
          syncRunId,
          syncWindowEndDate,
          syncWindowStartDate,
          supabase: input.supabase,
        }))
      )
        throw new SnapchatAdsSyncError('SYNC_STATUS_UPDATE_FAILED');
      return { accountId: account.accountId, rowsWritten };
    } catch (error) {
      if (codeOf(error) === 'SNAPCHAT_ADS_ACCESS_REVOKED')
        await markSnapchatAdsReauthRequired({
          connection,
          credentialSupabase: input.credentialSupabase,
          failureCode: codeOf(error),
          merchantId: input.merchantId,
        });
      throw error;
    }
  })();
  activeSyncs.set(key, work);
  try {
    return await work;
  } finally {
    activeSyncs.delete(key);
  }
}
