import 'server-only';

import { z } from 'zod';
import {
  GOOGLE_ADS_SCOPE,
  type GoogleAdsOAuthConfig,
} from '@/lib/google-ads/config';
import {
  constantTimeStringEqual,
  createGoogleAdsOAuthStateSignature,
  createGoogleAdsPkceChallenge,
  generateGoogleAdsRandomValue,
} from '@/lib/google-ads/crypto';

export const GOOGLE_ADS_AUTHORIZATION_ENDPOINT =
  'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_ADS_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const GOOGLE_ADS_OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface GoogleAdsOAuthStatePayload {
  merchantId: string;
  nonce: string;
  userId: string;
  issuedAt: number;
}

export interface GoogleAdsPkcePair {
  verifier: string;
  challenge: string;
}

export class GoogleAdsOAuthError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, status?: number) {
    super(code);
    this.name = 'GoogleAdsOAuthError';
    this.code = code;
    this.status = status;
  }
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}

export function createGoogleAdsOAuthState(
  payload: Omit<GoogleAdsOAuthStatePayload, 'issuedAt'>,
  stateSecret: string,
  now = Date.now()
): string {
  const body = encodeJson({ ...payload, issuedAt: now });
  const signature = createGoogleAdsOAuthStateSignature(body, stateSecret);
  return `${body}.${signature}`;
}

export function verifyGoogleAdsOAuthState(
  state: string,
  stateSecret: string,
  now = Date.now()
): GoogleAdsOAuthStatePayload | null {
  const [body, signature, extra] = state.split('.');
  if (!body || !signature || extra) return null;
  const expectedSignature = createGoogleAdsOAuthStateSignature(
    body,
    stateSecret
  );
  if (!constantTimeStringEqual(signature, expectedSignature)) return null;
  try {
    const payload = decodeJson<GoogleAdsOAuthStatePayload>(body);
    if (
      !payload ||
      typeof payload.merchantId !== 'string' ||
      typeof payload.userId !== 'string' ||
      typeof payload.nonce !== 'string' ||
      !Number.isFinite(payload.issuedAt)
    ) {
      return null;
    }
    const ageSeconds = (now - payload.issuedAt) / 1000;
    if (ageSeconds < -30 || ageSeconds > GOOGLE_ADS_OAUTH_STATE_TTL_SECONDS) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function createGoogleAdsPkcePair(): GoogleAdsPkcePair {
  const verifier = generateGoogleAdsRandomValue(48);
  return {
    challenge: createGoogleAdsPkceChallenge(verifier),
    verifier,
  };
}

export function buildGoogleAdsAuthorizationUrl(
  config: Pick<GoogleAdsOAuthConfig, 'clientId' | 'redirectUri'>,
  state: string,
  pkce: GoogleAdsPkcePair
): string {
  const url = new URL(GOOGLE_ADS_AUTHORIZATION_ENDPOINT);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_ADS_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

const googleAdsTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

export type GoogleAdsTokenResponse = z.infer<
  typeof googleAdsTokenResponseSchema
>;

export async function exchangeGoogleAdsAuthorizationCode(
  input: Pick<
    GoogleAdsOAuthConfig,
    'clientId' | 'clientSecret' | 'redirectUri'
  > & {
    code: string;
    codeVerifier: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<GoogleAdsTokenResponse> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    code_verifier: input.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
  });
  const response = await fetchImpl(GOOGLE_ADS_TOKEN_ENDPOINT, {
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  if (!response.ok) {
    throw new GoogleAdsOAuthError(
      'GOOGLE_ADS_TOKEN_EXCHANGE_FAILED',
      response.status
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GoogleAdsOAuthError(
      'GOOGLE_ADS_TOKEN_RESPONSE_INVALID',
      response.status
    );
  }
  const parsed = googleAdsTokenResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new GoogleAdsOAuthError(
      'GOOGLE_ADS_TOKEN_RESPONSE_INVALID',
      response.status
    );
  }
  return parsed.data;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function readNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readNonNegativeIntegerString(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return /^\d+$/.test(normalized) ? normalized : null;
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : null;
}

function isValidGoogleAdsDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed) && new Date(parsed).toISOString().startsWith(value)
  );
}

function spendResponseError(): never {
  throw new GoogleAdsOAuthError('GOOGLE_ADS_SPEND_RESPONSE_INVALID');
}

export interface GoogleAdsSpendRow {
  clicks: number;
  conversions: number;
  customerId: string;
  currencyCode: string;
  date: string;
  impressions: number;
  spendMicros: string;
}

/** Parse Google Ads searchStream batches without retaining provider payloads. */
export function parseGoogleAdsSpendRows(payload: unknown): GoogleAdsSpendRow[] {
  const batches = Array.isArray(payload) ? payload : [payload];
  const rows: GoogleAdsSpendRow[] = [];
  for (const batch of batches) {
    const batchRecord = asRecord(batch);
    if (!batchRecord) spendResponseError();
    const resultList = batchRecord?.results;
    if (!Array.isArray(resultList)) spendResponseError();
    for (const item of resultList) {
      const record = asRecord(item);
      if (!record) spendResponseError();
      const customer = asRecord(record?.customer);
      const segments = asRecord(record?.segments);
      const metrics = asRecord(record?.metrics);
      const customerId =
        typeof customer?.id === 'string' && /^\d{10}$/.test(customer.id)
          ? customer.id
          : '';
      const currencyCode =
        typeof customer?.currencyCode === 'string' &&
        /^[A-Z]{3}$/.test(customer.currencyCode)
          ? customer.currencyCode
          : typeof customer?.currency_code === 'string' &&
              /^[A-Z]{3}$/.test(customer.currency_code)
            ? customer.currency_code
            : '';
      const date = typeof segments?.date === 'string' ? segments.date : '';
      const clicks = readNonNegativeNumber(metrics?.clicks);
      const conversions = readNonNegativeNumber(metrics?.conversions);
      const impressions = readNonNegativeNumber(metrics?.impressions);
      const spendMicros = readNonNegativeIntegerString(metrics?.costMicros);
      if (
        !customerId ||
        !currencyCode ||
        !isValidGoogleAdsDate(date) ||
        !metrics ||
        clicks === null ||
        conversions === null ||
        impressions === null ||
        spendMicros === null
      ) {
        spendResponseError();
      }
      rows.push({
        clicks,
        conversions,
        customerId,
        currencyCode,
        date,
        impressions,
        spendMicros,
      });
    }
  }
  return rows;
}
