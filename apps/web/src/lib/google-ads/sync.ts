import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  markAdsSyncStarted,
  markFinalAdsSync,
} from '@/lib/ads/mark-final-ads-sync';
import type { AdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import {
  type GoogleAdsResolvedAccessToken,
  resolveGoogleAdsAccessToken,
} from '@/lib/google-ads/access-token';
import {
  getGoogleAdsOAuthConfig,
  getGoogleAdsReportingConfig,
} from '@/lib/google-ads/config';
import {
  fetchGoogleAdsDailySpend,
  GoogleAdsProviderError,
} from '@/lib/google-ads/provider';
import {
  getGoogleAdsReauthReason,
  persistGoogleAdsReauthRequired,
} from '@/lib/google-ads/reauth';
import { googleAdsSyncRequestSchema } from '@/schemas/google-ads';

export class GoogleAdsSyncError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'GoogleAdsSyncError';
    this.code = code;
  }
}

export async function syncGoogleAdsSpendForMerchant(
  input: {
    endDate: string;
    finalChunk?: boolean;
    merchantId: string;
    credentialSupabase: AdsCredentialServiceClient;
    spendSupabase: SupabaseClient;
    startDate: string;
    syncRunId?: string;
    syncRunStartedAt?: string;
    syncWindowEndDate?: string;
    syncWindowStartDate?: string;
    supabase: SupabaseClient;
  },
  fetchImpl: typeof fetch = fetch
): Promise<{ rowsWritten: number; customerId: string }> {
  if (
    !googleAdsSyncRequestSchema.safeParse({
      endDate: input.endDate,
      startDate: input.startDate,
      syncRunId: input.syncRunId,
      syncRunStartedAt: input.syncRunStartedAt,
      syncWindowEndDate: input.syncWindowEndDate,
      syncWindowStartDate: input.syncWindowStartDate,
    }).success
  ) {
    throw new GoogleAdsSyncError('INVALID_DATE_RANGE');
  }
  const syncRunId = input.syncRunId ?? crypto.randomUUID();
  const syncRunStartedAt = input.syncRunStartedAt ?? new Date().toISOString();
  const syncWindowStartDate = input.syncWindowStartDate ?? input.startDate;
  const syncWindowEndDate = input.syncWindowEndDate ?? input.endDate;
  const oauthConfig = getGoogleAdsOAuthConfig();
  const reportingConfig = getGoogleAdsReportingConfig();
  const { data: connections, error: connectionError } =
    await input.credentialSupabase.rpc('get_google_ads_connection_secret', {
      p_merchant_id: input.merchantId,
    });
  if (connectionError) throw new GoogleAdsSyncError('CONNECTION_READ_FAILED');
  let connection = connections?.[0] ?? null;
  if (!connection?.provider_customer_id) {
    throw new GoogleAdsSyncError('GOOGLE_ADS_CUSTOMER_NOT_SELECTED');
  }
  const customerId = connection.provider_customer_id;

  let resolvedToken: GoogleAdsResolvedAccessToken;
  try {
    resolvedToken = await resolveGoogleAdsAccessToken(
      connection,
      oauthConfig,
      fetchImpl
    );
  } catch (error) {
    const reauthReason = getGoogleAdsReauthReason(error);
    if (reauthReason) {
      const persisted = await persistGoogleAdsReauthRequired({
        connection,
        credentialSupabase: input.credentialSupabase,
        merchantId: input.merchantId,
        reason: reauthReason,
      });
      if (!persisted) {
        throw new GoogleAdsSyncError('REAUTH_STATUS_UPDATE_FAILED');
      }
    }
    throw new GoogleAdsSyncError(
      error instanceof Error
        ? error.message.replace(/^GOOGLE_ADS_/, '')
        : 'ACCESS_TOKEN_RESOLUTION_FAILED'
    );
  }
  if (resolvedToken.encryptedAccessToken) {
    const { data: tokenUpdated, error: tokenUpdateError } =
      await input.credentialSupabase.rpc(
        'update_google_ads_connection_token_if_current',
        {
          p_access_token_ciphertext: resolvedToken.encryptedAccessToken,
          p_expected_access_token_ciphertext:
            connection.access_token_ciphertext,
          p_expected_refresh_token_ciphertext:
            connection.refresh_token_ciphertext,
          p_merchant_id: input.merchantId,
          p_token_expires_at: resolvedToken.expiresAt,
        }
      );
    if (tokenUpdateError || tokenUpdated !== true) {
      throw new GoogleAdsSyncError('TOKEN_UPDATE_FAILED');
    }
    connection = {
      ...connection,
      access_token_ciphertext: resolvedToken.encryptedAccessToken,
      token_expires_at: resolvedToken.expiresAt,
    };
  }

  if (
    !(await markAdsSyncStarted({
      merchantId: input.merchantId,
      provider: 'google_ads',
      providerCustomerId: customerId,
      syncRunId,
      syncRunStartedAt,
      syncWindowEndDate,
      syncWindowStartDate,
      supabase: input.supabase,
    }))
  )
    throw new GoogleAdsSyncError('SYNC_STATUS_UPDATE_FAILED');

  let rows: Awaited<ReturnType<typeof fetchGoogleAdsDailySpend>>;
  try {
    rows = await fetchGoogleAdsDailySpend(
      {
        accessToken: resolvedToken.accessToken,
        customerId,
        endDate: input.endDate,
        reportingConfig,
        startDate: input.startDate,
      },
      fetchImpl
    );
  } catch (error) {
    if (error instanceof GoogleAdsProviderError && error.status === 401) {
      const persisted = await persistGoogleAdsReauthRequired({
        connection,
        credentialSupabase: input.credentialSupabase,
        merchantId: input.merchantId,
        reason: 'GOOGLE_ADS_ACCESS_REVOKED',
      });
      if (!persisted) {
        throw new GoogleAdsSyncError('REAUTH_STATUS_UPDATE_FAILED');
      }
    }
    throw error;
  }
  const records = rows.map((row) => ({
    clicks: Math.trunc(row.clicks),
    conversions: row.conversions,
    currency_code: row.currencyCode,
    fetched_at: new Date().toISOString(),
    impressions: Math.trunc(row.impressions),
    provider_customer_id: row.customerId,
    spend_date: row.date,
    spend_micros: row.spendMicros,
  }));
  const { error: replaceError } = await input.spendSupabase.rpc(
    'replace_google_ads_spend_daily',
    {
      p_end_date: input.endDate,
      p_merchant_id: input.merchantId,
      p_provider_customer_id: customerId,
      p_rows: records,
      p_start_date: input.startDate,
      p_sync_run_id: syncRunId,
    }
  );
  if (replaceError) {
    throw new GoogleAdsSyncError('SPEND_WRITE_FAILED');
  }

  if (
    !(await markFinalAdsSync({
      finalChunk: input.finalChunk,
      merchantId: input.merchantId,
      provider: 'google_ads',
      providerCustomerId: customerId,
      syncRunId,
      syncWindowEndDate,
      syncWindowStartDate,
      supabase: input.supabase,
    }))
  )
    throw new GoogleAdsSyncError('SYNC_STATUS_UPDATE_FAILED');

  return {
    customerId,
    rowsWritten: records.length,
  };
}
