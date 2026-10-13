import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  markAdsSyncStarted,
  markFinalAdsSync,
} from '@/lib/ads/mark-final-ads-sync';
import type { AdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import { metaAdsSyncRequestSchema } from '@/schemas/meta-ads';
import { resolveMetaAdsAccessToken } from './access-token';
import { getMetaAdsConfig } from './config';
import type { MetaAdsConnection } from './connection-types';
import { META_ADS_PROVIDER } from './constants';
import {
  fetchMetaAdsDailyInsights,
  listMetaAdsAccounts,
  MetaAdsProviderError,
  type MetaAdsUsageTelemetry,
} from './provider';
import { buildMetaAdsSpendRecords } from './spend-records';

export class MetaAdsSyncError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'MetaAdsSyncError';
  }
}

export class MetaAdsReauthPersistenceError extends Error {
  readonly code = 'META_ADS_REAUTH_PERSIST_FAILED';

  constructor() {
    super('META_ADS_REAUTH_PERSIST_FAILED');
    this.name = 'MetaAdsReauthPersistenceError';
  }
}
const inFlightSyncs = new Map<
  string,
  Promise<{ accountId: string; rowsWritten: number }>
>();

export async function markMetaAdsReauthRequired(input: {
  connection: MetaAdsConnection;
  credentialSupabase: AdsCredentialServiceClient;
  failureCode: string;
  merchantId: string;
}): Promise<void> {
  const { error } = await input.credentialSupabase.rpc(
    'mark_merchant_ads_connection_reauth_if_current',
    {
      p_access_token_ciphertext: input.connection.access_token_ciphertext,
      p_merchant_id: input.merchantId,
      p_provider: META_ADS_PROVIDER,
      p_refresh_token_ciphertext:
        input.connection.refresh_token_ciphertext ?? null,
      p_reason: input.failureCode,
    }
  );
  // False means a concurrent reauthorization already replaced the grant.
  if (error) throw new MetaAdsReauthPersistenceError();
}

function shouldRequireReauth(error: unknown): boolean {
  const candidateCode =
    error instanceof MetaAdsProviderError
      ? error.code
      : error && typeof error === 'object'
        ? (error as { code?: unknown }).code
        : null;
  const code =
    typeof candidateCode === 'string'
      ? candidateCode
      : error instanceof Error
        ? error.message
        : null;
  return (
    code === 'META_ADS_REAUTH_REQUIRED' ||
    code === 'META_ADS_ACCESS_REVOKED' ||
    code === 'META_ADS_ACCESS_TOKEN_DECRYPT_FAILED' ||
    code === 'META_ADS_ADS_READ_NOT_GRANTED'
  );
}

function reauthFailureCode(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return error instanceof Error ? error.message : 'META_ADS_REAUTH_REQUIRED';
}

export async function syncMetaAdsSpendForMerchant(
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
    !metaAdsSyncRequestSchema.safeParse({
      endDate: input.endDate,
      startDate: input.startDate,
      syncRunId: input.syncRunId,
      syncRunStartedAt: input.syncRunStartedAt,
      syncWindowEndDate: input.syncWindowEndDate,
      syncWindowStartDate: input.syncWindowStartDate,
    }).success
  ) {
    throw new MetaAdsSyncError('INVALID_DATE_RANGE');
  }
  const syncRunId = input.syncRunId ?? crypto.randomUUID();
  const syncRunStartedAt = input.syncRunStartedAt ?? new Date().toISOString();
  const syncWindowStartDate = input.syncWindowStartDate ?? input.startDate;
  const syncWindowEndDate = input.syncWindowEndDate ?? input.endDate;
  const config = getMetaAdsConfig();
  const { data: connections, error: connectionError } =
    await input.credentialSupabase.rpc('get_merchant_ads_connection_secret', {
      p_merchant_id: input.merchantId,
      p_provider: META_ADS_PROVIDER,
    });
  if (connectionError) throw new MetaAdsSyncError('CONNECTION_READ_FAILED');
  const connection = connections?.[0] ?? null;
  if (!connection?.provider_customer_id)
    throw new MetaAdsSyncError('META_ADS_ACCOUNT_NOT_SELECTED');
  let accessToken: string;
  try {
    accessToken = resolveMetaAdsAccessToken(connection, config);
  } catch (error) {
    if (shouldRequireReauth(error)) {
      try {
        await markMetaAdsReauthRequired({
          connection,
          failureCode: reauthFailureCode(error),
          merchantId: input.merchantId,
          credentialSupabase: input.credentialSupabase,
        });
      } catch {
        throw new MetaAdsSyncError('META_ADS_REAUTH_PERSIST_FAILED');
      }
    }
    throw new MetaAdsSyncError(reauthFailureCode(error));
  }
  const syncKey = `${input.merchantId}:${connection.provider_customer_id}:${input.startDate}:${input.endDate}:${input.finalChunk !== false}:${syncRunId}`;
  const activeSync = inFlightSyncs.get(syncKey);
  if (activeSync) return activeSync;
  const syncPromise = syncSelectedMetaAdsAccount({
    accessToken,
    connection,
    endDate: input.endDate,
    fetchImpl,
    finalChunk: input.finalChunk,
    merchantId: input.merchantId,
    credentialSupabase: input.credentialSupabase,
    spendSupabase: input.spendSupabase,
    startDate: input.startDate,
    syncRunId,
    syncRunStartedAt,
    syncWindowEndDate,
    syncWindowStartDate,
    supabase: input.supabase,
  });
  inFlightSyncs.set(syncKey, syncPromise);
  try {
    return await syncPromise;
  } finally {
    inFlightSyncs.delete(syncKey);
  }
}

async function syncSelectedMetaAdsAccount(input: {
  accessToken: string;
  connection: MetaAdsConnection;
  endDate: string;
  fetchImpl: typeof fetch;
  finalChunk?: boolean;
  merchantId: string;
  credentialSupabase: AdsCredentialServiceClient;
  spendSupabase: SupabaseClient;
  startDate: string;
  syncRunId: string;
  syncRunStartedAt: string;
  syncWindowEndDate: string;
  syncWindowStartDate: string;
  supabase: SupabaseClient;
}): Promise<{ accountId: string; rowsWritten: number }> {
  let usageTelemetry: MetaAdsUsageTelemetry | null = null;
  try {
    const providerCustomerId = input.connection.provider_customer_id;
    if (!providerCustomerId)
      throw new MetaAdsSyncError('META_ADS_ACCOUNT_NOT_SELECTED');
    if (
      !(await markAdsSyncStarted({
        merchantId: input.merchantId,
        provider: META_ADS_PROVIDER,
        providerCustomerId,
        syncRunId: input.syncRunId,
        syncRunStartedAt: input.syncRunStartedAt,
        syncWindowEndDate: input.syncWindowEndDate,
        syncWindowStartDate: input.syncWindowStartDate,
        supabase: input.supabase,
      }))
    )
      throw new MetaAdsSyncError('SYNC_STATUS_UPDATE_FAILED');

    const collectTelemetry = (telemetry: MetaAdsUsageTelemetry) => {
      usageTelemetry = telemetry;
    };
    const accounts = await listMetaAdsAccounts(
      input.accessToken,
      input.fetchImpl,
      undefined,
      collectTelemetry
    );
    const account = accounts.find(
      (candidate) => candidate.accountId === providerCustomerId
    );
    if (!account) throw new MetaAdsSyncError('META_ADS_ACCOUNT_NOT_ACCESSIBLE');
    const insights = await fetchMetaAdsDailyInsights(
      {
        accessToken: input.accessToken,
        accountId: account.accountId,
        endDate: input.endDate,
        startDate: input.startDate,
      },
      input.fetchImpl,
      undefined,
      collectTelemetry
    );
    const fetchedAt = new Date().toISOString();
    const records = buildMetaAdsSpendRecords({
      account,
      fetchedAt,
      insights,
      usageTelemetry,
    });
    const { data: rowsWritten, error: spendWriteError } =
      await input.spendSupabase.rpc('replace_merchant_ads_spend_daily_window', {
        p_end_date: input.endDate,
        p_merchant_id: input.merchantId,
        p_provider: META_ADS_PROVIDER,
        p_provider_customer_id: account.accountId,
        p_rows: records,
        p_start_date: input.startDate,
        p_sync_run_id: input.syncRunId,
      });
    if (spendWriteError) throw new MetaAdsSyncError('SPEND_WRITE_FAILED');
    if (
      !(await markFinalAdsSync({
        finalChunk: input.finalChunk,
        merchantId: input.merchantId,
        provider: META_ADS_PROVIDER,
        providerCustomerId: account.accountId,
        syncRunId: input.syncRunId,
        syncWindowEndDate: input.syncWindowEndDate,
        syncWindowStartDate: input.syncWindowStartDate,
        supabase: input.supabase,
      }))
    )
      throw new MetaAdsSyncError('SYNC_STATUS_UPDATE_FAILED');
    return { accountId: account.accountId, rowsWritten: rowsWritten ?? 0 };
  } catch (error) {
    if (shouldRequireReauth(error)) {
      try {
        await markMetaAdsReauthRequired({
          connection: input.connection,
          failureCode: reauthFailureCode(error),
          merchantId: input.merchantId,
          credentialSupabase: input.credentialSupabase,
        });
      } catch {
        throw new MetaAdsSyncError('META_ADS_REAUTH_PERSIST_FAILED');
      }
    }
    if (error instanceof MetaAdsSyncError) throw error;
    throw error;
  }
}
