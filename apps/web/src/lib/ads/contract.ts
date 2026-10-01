import 'server-only';

export const ADS_PROVIDERS = [
  'google_ads',
  'meta_ads',
  'tiktok_ads',
  'snapchat_ads',
] as const;

export type AdsProvider = (typeof ADS_PROVIDERS)[number];

export const ADS_OAUTH_STORAGE_PROVIDERS = [
  'meta_ads',
  'tiktok_ads',
  'snapchat_ads',
] as const;

export type AdsOAuthStorageProvider =
  (typeof ADS_OAUTH_STORAGE_PROVIDERS)[number];

export interface AdsConnectionMetadata {
  accountTimezone: string | null;
  lastSyncedAt: string | null;
  provider: AdsProvider;
  providerAccountId: string | null;
  providerAccountLabel: string | null;
  scopes: string[];
  status: 'active' | 'disconnected' | 'error';
  tokenExpiresAt: string | null;
}

export interface AdsSpendRowInput {
  accountTimezone: string;
  attributionMetadata: Record<string, unknown>;
  clicks: string;
  conversions: string;
  currencyCode: string;
  fetchedAt: string;
  impressions: string;
  provider: AdsProvider;
  providerCustomerId: string;
  reach?: string;
  spendAmountDecimal: string;
  spendDate: string;
  spendMicros: string;
}

export interface AdsSpendRow extends AdsSpendRowInput {
  currencyCode: string;
}

export interface AdsAccount {
  currencyCode: string;
  id: string;
  label: string;
  timezone: string;
}

export interface AdsAuthorizationRequest {
  redirectUri: string;
  state: string;
}

export interface AdsTokenExchangeInput {
  code: string;
  redirectUri: string;
}

export interface AdsAdapter {
  buildAuthorizationUrl(input: AdsAuthorizationRequest): URL;
  exchangeCode(input: AdsTokenExchangeInput): Promise<void>;
  fetchDailyReport(): Promise<AdsSpendRow[]>;
  listAccounts(): Promise<AdsAccount[]>;
}

const ISO_CURRENCY = /^[A-Z]{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const NON_NEGATIVE_DECIMAL = /^\d+(?:\.\d+)?$/;
const NON_NEGATIVE_INTEGER = /^\d+$/;

export function isAdsProvider(value: string): value is AdsProvider {
  return ADS_PROVIDERS.includes(value as AdsProvider);
}

export function isAdsOAuthStorageProvider(
  value: string
): value is AdsOAuthStorageProvider {
  return ADS_OAUTH_STORAGE_PROVIDERS.includes(value as AdsOAuthStorageProvider);
}

function assertNonNegativeDecimal(value: string, field: string): void {
  if (!NON_NEGATIVE_DECIMAL.test(value)) {
    throw new Error(`${field} must be a non-negative decimal string`);
  }
}

function assertNonNegativeInteger(value: string, field: string): void {
  if (!NON_NEGATIVE_INTEGER.test(value)) {
    throw new Error(`${field} must be a non-negative integer string`);
  }
}

export function normalizeAdsSpendRow(input: AdsSpendRowInput): AdsSpendRow {
  if (!input.providerCustomerId.trim()) {
    throw new Error('providerCustomerId is required');
  }
  if (!ISO_DATE.test(input.spendDate)) {
    throw new Error('spendDate must be an ISO date');
  }
  if (!input.accountTimezone.trim()) {
    throw new Error('accountTimezone is required');
  }
  if (
    !ISO_TIMESTAMP.test(input.fetchedAt) ||
    !Number.isFinite(Date.parse(input.fetchedAt))
  ) {
    throw new Error('fetchedAt must be an ISO timestamp');
  }
  if (
    !input.attributionMetadata ||
    Array.isArray(input.attributionMetadata) ||
    typeof input.attributionMetadata !== 'object'
  ) {
    throw new Error('attributionMetadata must be an object');
  }

  const currencyCode = input.currencyCode.toUpperCase();
  if (!ISO_CURRENCY.test(currencyCode)) {
    throw new Error('currencyCode must be an ISO-4217 code');
  }
  assertNonNegativeDecimal(input.spendAmountDecimal, 'spendAmountDecimal');
  assertNonNegativeInteger(input.spendMicros, 'spendMicros');
  assertNonNegativeInteger(input.impressions, 'impressions');
  assertNonNegativeInteger(input.clicks, 'clicks');
  assertNonNegativeDecimal(input.conversions, 'conversions');
  if (input.reach !== undefined) {
    assertNonNegativeInteger(input.reach, 'reach');
  }

  return { ...input, currencyCode };
}
