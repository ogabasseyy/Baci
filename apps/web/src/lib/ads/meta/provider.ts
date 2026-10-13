import 'server-only';

import { META_ADS_GRAPH_ROOT } from './oauth';
import {
  createMetaAdsRetryBudget,
  fetchMetaJson,
  finiteNonNegativeNumber,
  MetaAdsProviderError,
  type MetaAdsUsageTelemetry,
} from './provider-http';
import {
  type MetaAdsAccount,
  parseMetaAdsAccount,
  parseMetaAdsDailyInsights,
} from './provider-parser';
import type { MetaAdsDailyInsight } from './provider-types';

const MAX_ACCOUNT_PAGES = 20;
const MAX_INSIGHTS_PAGES = 20;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export {
  type MetaAdsAccount,
  type MetaAdsDailyInsight,
  MetaAdsProviderError,
  type MetaAdsUsageTelemetry,
  parseMetaAdsDailyInsights,
};

export async function listMetaAdsAccounts(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
  sleep?: (milliseconds: number) => Promise<void>,
  onTelemetry?: (telemetry: MetaAdsUsageTelemetry) => void
): Promise<MetaAdsAccount[]> {
  const retryBudget = createMetaAdsRetryBudget();
  let next: URL | null = new URL(`${META_ADS_GRAPH_ROOT}/me/adaccounts`);
  next.searchParams.set(
    'fields',
    'id,account_id,name,account_status,currency,timezone_name,timezone_offset_hours_utc'
  );
  next.searchParams.set('limit', '100');
  const accounts = new Map<string, MetaAdsAccount>();
  for (let page = 0; next && page < MAX_ACCOUNT_PAGES; page += 1) {
    const payload = await fetchMetaJson(
      next,
      accessToken,
      'META_ADS_ACCOUNT_DISCOVERY_FAILED',
      fetchImpl,
      sleep,
      onTelemetry,
      retryBudget
    );
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { data?: unknown; paging?: { next?: unknown } })
        : null;
    if (!record || !Array.isArray(record.data))
      throw new MetaAdsProviderError('META_ADS_ACCOUNT_DISCOVERY_INVALID');
    for (const entry of record.data) {
      const account = parseMetaAdsAccount(entry);
      if (account) accounts.set(account.accountId, account);
    }
    const nextValue = record.paging?.next;
    try {
      next = typeof nextValue === 'string' ? new URL(nextValue) : null;
      if (next && next.origin !== 'https://graph.facebook.com')
        throw new Error('unexpected paging origin');
    } catch {
      throw new MetaAdsProviderError('META_ADS_ACCOUNT_PAGING_INVALID');
    }
  }
  if (next) throw new MetaAdsProviderError('META_ADS_ACCOUNT_PAGING_LIMIT');
  return [...accounts.values()];
}

export async function fetchMetaAdsDailyInsights(
  input: {
    accessToken: string;
    accountId: string;
    endDate: string;
    startDate: string;
  },
  fetchImpl: typeof fetch = fetch,
  sleep?: (milliseconds: number) => Promise<void>,
  onTelemetry?: (telemetry: MetaAdsUsageTelemetry) => void
): Promise<MetaAdsDailyInsight[]> {
  if (
    !/^act_\d+$/.test(input.accountId) ||
    !ISO_DATE.test(input.startDate) ||
    !ISO_DATE.test(input.endDate) ||
    input.startDate > input.endDate
  ) {
    throw new MetaAdsProviderError('META_ADS_INSIGHTS_INPUT_INVALID');
  }
  const url = new URL(`${META_ADS_GRAPH_ROOT}/${input.accountId}/insights`);
  url.searchParams.set('level', 'account');
  url.searchParams.set(
    'time_range',
    JSON.stringify({ since: input.startDate, until: input.endDate })
  );
  url.searchParams.set('time_increment', '1');
  url.searchParams.set('limit', '100');
  url.searchParams.set(
    'fields',
    'account_id,account_name,date_start,date_stop,spend,impressions,clicks,reach,actions,action_values,attribution_setting'
  );
  url.searchParams.set('use_unified_attribution_setting', 'true');
  const expectedPath = `/${META_ADS_GRAPH_ROOT.split('/').at(-1)}/${input.accountId}/insights`;
  const insights: MetaAdsDailyInsight[] = [];
  const retryBudget = createMetaAdsRetryBudget();
  let next: URL | null = url;
  for (let page = 0; next && page < MAX_INSIGHTS_PAGES; page += 1) {
    const payload = await fetchMetaJson(
      next,
      input.accessToken,
      'META_ADS_INSIGHTS_FAILED',
      fetchImpl,
      sleep,
      onTelemetry,
      retryBudget
    );
    insights.push(...parseMetaAdsDailyInsights(payload, input.accountId));
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { paging?: { next?: unknown } })
        : null;
    const nextValue = record?.paging?.next;
    try {
      next = typeof nextValue === 'string' ? new URL(nextValue) : null;
      if (
        next &&
        (next.origin !== 'https://graph.facebook.com' ||
          next.pathname !== expectedPath)
      ) {
        throw new Error('unexpected insights paging URL');
      }
    } catch {
      throw new MetaAdsProviderError('META_ADS_INSIGHTS_PAGING_INVALID');
    }
  }
  if (next) throw new MetaAdsProviderError('META_ADS_INSIGHTS_PAGING_LIMIT');
  return insights;
}

export async function validateMetaAdsGrant(
  input: { accessToken: string; appId: string; appSecret: string },
  fetchImpl: typeof fetch = fetch
): Promise<{ providerUserId: string }> {
  const retryBudget = createMetaAdsRetryBudget();
  const debugUrl = new URL(`${META_ADS_GRAPH_ROOT}/debug_token`);
  debugUrl.searchParams.set('input_token', input.accessToken);
  debugUrl.searchParams.set(
    'access_token',
    `${input.appId}|${input.appSecret}`
  );
  const debugPayload = await fetchMetaJson(
    debugUrl,
    `${input.appId}|${input.appSecret}`,
    'META_ADS_TOKEN_INVALID',
    fetchImpl,
    undefined,
    undefined,
    retryBudget
  );
  const data =
    debugPayload &&
    typeof debugPayload === 'object' &&
    !Array.isArray(debugPayload)
      ? (
          debugPayload as {
            data?: {
              app_id?: unknown;
              expires_at?: unknown;
              is_valid?: unknown;
              type?: unknown;
              user_id?: unknown;
            };
          }
        ).data
      : null;
  const expiresAt = finiteNonNegativeNumber(data?.expires_at);
  const providerUserId =
    typeof data?.user_id === 'string' && data.user_id.trim()
      ? data.user_id
      : null;
  if (
    data?.is_valid !== true ||
    String(data.app_id) !== input.appId ||
    String(data.type).toUpperCase() !== 'USER' ||
    !providerUserId ||
    expiresAt === null ||
    expiresAt <= Date.now() / 1000 + 60
  )
    throw new MetaAdsProviderError('META_ADS_TOKEN_INVALID');
  const meUrl = new URL(`${META_ADS_GRAPH_ROOT}/me`);
  meUrl.searchParams.set('fields', 'id');
  const mePayload = await fetchMetaJson(
    meUrl,
    input.accessToken,
    'META_ADS_PROVIDER_IDENTITY_CHECK_FAILED',
    fetchImpl,
    undefined,
    undefined,
    retryBudget
  );
  const meId =
    mePayload && typeof mePayload === 'object' && !Array.isArray(mePayload)
      ? (mePayload as { id?: unknown }).id
      : null;
  if (typeof meId !== 'string' || meId !== providerUserId)
    throw new MetaAdsProviderError('META_ADS_PROVIDER_IDENTITY_MISMATCH');
  const permissionsUrl = new URL(`${META_ADS_GRAPH_ROOT}/me/permissions`);
  const permissionsPayload = await fetchMetaJson(
    permissionsUrl,
    input.accessToken,
    'META_ADS_PERMISSION_CHECK_FAILED',
    fetchImpl,
    undefined,
    undefined,
    retryBudget
  );
  const permissions =
    permissionsPayload &&
    typeof permissionsPayload === 'object' &&
    !Array.isArray(permissionsPayload)
      ? (permissionsPayload as { data?: unknown }).data
      : null;
  const hasAdsRead =
    Array.isArray(permissions) &&
    permissions.some(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        (entry as { permission?: unknown }).permission === 'ads_read' &&
        (entry as { status?: unknown }).status === 'granted'
    );
  if (!hasAdsRead)
    throw new MetaAdsProviderError('META_ADS_ADS_READ_NOT_GRANTED');
  return { providerUserId };
}
