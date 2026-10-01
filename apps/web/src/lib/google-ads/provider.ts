import 'server-only';

import { z } from 'zod';
import type { GoogleAdsReportingConfig } from '@/lib/google-ads/config';
import {
  GOOGLE_ADS_TOKEN_ENDPOINT,
  type GoogleAdsSpendRow,
  parseGoogleAdsSpendRows,
} from '@/lib/google-ads/oauth';
import { discoverGoogleAdsCustomerIds } from './account-discovery';

export {
  GOOGLE_ADS_ACCOUNT_DISCOVERY_LIMIT,
  GOOGLE_ADS_DISCOVERY_LIMIT_CODES,
  GOOGLE_ADS_MANAGER_DEPTH_LIMIT,
  GOOGLE_ADS_MANAGER_DISCOVERY_LIMIT,
} from './account-discovery';

export const GOOGLE_ADS_DEFAULT_API_VERSION = 'v25' as const;

export function getGoogleAdsApiRoot(): string {
  const version =
    process.env.GOOGLE_ADS_API_VERSION?.trim() ||
    GOOGLE_ADS_DEFAULT_API_VERSION;
  if (!/^v\d+$/.test(version)) {
    throw new GoogleAdsProviderError('GOOGLE_ADS_API_VERSION_INVALID');
  }
  return `https://googleads.googleapis.com/${version}`;
}

export class GoogleAdsProviderError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, status?: number) {
    super(code);
    this.name = 'GoogleAdsProviderError';
    this.code = code;
    this.status = status;
  }
}

const refreshedTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive().optional(),
});

function providerHeaders(
  accessToken: string,
  reportingConfig: GoogleAdsReportingConfig
): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': reportingConfig.developerToken,
    ...(reportingConfig.loginCustomerId
      ? { 'login-customer-id': reportingConfig.loginCustomerId }
      : {}),
  };
}

function parseGoogleAdsCustomerId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const customerId = value.replace(/^customers\//, '');
  return /^\d{10}$/.test(customerId) ? customerId : null;
}

export async function refreshGoogleAdsAccessToken(
  input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<{ accessToken: string; expiresAt: string | null }> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  });
  const response = await fetchImpl(GOOGLE_ADS_TOKEN_ENDPOINT, {
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  if (!response.ok) {
    throw new GoogleAdsProviderError(
      'GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED',
      response.status
    );
  }
  const parsed = refreshedTokenSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new GoogleAdsProviderError(
      'GOOGLE_ADS_ACCESS_TOKEN_RESPONSE_INVALID'
    );
  }
  return {
    accessToken: parsed.data.access_token,
    expiresAt: parsed.data.expires_in
      ? new Date(Date.now() + parsed.data.expires_in * 1000).toISOString()
      : null,
  };
}

export async function listGoogleAdsAccessibleCustomerIds(
  accessToken: string,
  reportingConfig: GoogleAdsReportingConfig,
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  const apiRoot = getGoogleAdsApiRoot();
  const response = await fetchImpl(
    `${apiRoot}/customers:listAccessibleCustomers`,
    { headers: providerHeaders(accessToken, reportingConfig) }
  );
  if (!response.ok) {
    throw new GoogleAdsProviderError(
      'GOOGLE_ADS_ACCOUNT_DISCOVERY_FAILED',
      response.status
    );
  }
  const payload: unknown = await response.json();
  if (
    payload === null ||
    typeof payload !== 'object' ||
    !Array.isArray((payload as { resourceNames?: unknown }).resourceNames)
  ) {
    throw new GoogleAdsProviderError(
      'GOOGLE_ADS_ACCOUNT_DISCOVERY_RESPONSE_INVALID'
    );
  }
  const resourceNames = (payload as { resourceNames: unknown[] }).resourceNames;
  const directCustomerIds = resourceNames
    .filter((value: unknown): value is string => typeof value === 'string')
    .map(parseGoogleAdsCustomerId)
    .filter((value: string | null): value is string => value !== null);
  return discoverGoogleAdsCustomerIds({
    apiRoot,
    createError: (code, status) => new GoogleAdsProviderError(code, status),
    directCustomerIds,
    fetchImpl,
    headers: providerHeaders(accessToken, reportingConfig),
  });
}

export async function fetchGoogleAdsDailySpend(
  input: {
    accessToken: string;
    customerId: string;
    endDate: string;
    reportingConfig: GoogleAdsReportingConfig;
    startDate: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<GoogleAdsSpendRow[]> {
  if (!/^\d{10}$/.test(input.customerId)) {
    throw new GoogleAdsProviderError('GOOGLE_ADS_CUSTOMER_ID_INVALID');
  }
  const query = [
    'SELECT customer.id, customer.currency_code, segments.date, metrics.cost_micros,',
    'metrics.impressions, metrics.clicks, metrics.conversions',
    'FROM customer',
    `WHERE segments.date BETWEEN '${input.startDate}' AND '${input.endDate}'`,
  ].join(' ');
  const response = await fetchImpl(
    `${getGoogleAdsApiRoot()}/customers/${input.customerId}/googleAds:searchStream`,
    {
      body: JSON.stringify({ query }),
      headers: {
        ...providerHeaders(input.accessToken, input.reportingConfig),
        'Content-Type': 'application/json',
      },
      method: 'POST',
    }
  );
  if (!response.ok) {
    throw new GoogleAdsProviderError(
      'GOOGLE_ADS_SPEND_QUERY_FAILED',
      response.status
    );
  }
  return parseGoogleAdsSpendRows(await response.json());
}
