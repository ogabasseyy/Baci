import 'server-only';

import { validateCanonicalAdsCallbackUri } from './config';
import { type AdsProvider, isAdsProvider } from './contract';
import { createAdsStateSignature, timingSafeStringEqual } from './crypto';

const ADS_OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface AdsOAuthStatePayload {
  issuedAt: number;
  merchantId: string;
  nonce: string;
  provider: AdsProvider;
  redirectUri: string;
  userId: string;
}

export interface AdsOAuthStateExpectation {
  merchantId: string | null;
  provider: AdsProvider;
  redirectUri: string;
  userId: string;
}

function encodeJson(value: AdsOAuthStatePayload): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function parsePayload(value: unknown): AdsOAuthStatePayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.merchantId !== 'string' ||
    typeof record.nonce !== 'string' ||
    typeof record.userId !== 'string' ||
    typeof record.redirectUri !== 'string' ||
    typeof record.issuedAt !== 'number' ||
    !Number.isFinite(record.issuedAt) ||
    typeof record.provider !== 'string' ||
    !isAdsProvider(record.provider)
  ) {
    return null;
  }
  return {
    issuedAt: record.issuedAt,
    merchantId: record.merchantId,
    nonce: record.nonce,
    provider: record.provider,
    redirectUri: record.redirectUri,
    userId: record.userId,
  };
}

export function createAdsOAuthState(
  payload: Omit<AdsOAuthStatePayload, 'issuedAt'>,
  stateSecret: string,
  now = Date.now()
): string {
  const redirectUri = validateCanonicalAdsCallbackUri(
    payload.provider,
    payload.redirectUri
  );
  const body = encodeJson({ ...payload, issuedAt: now, redirectUri });
  return `${body}.${createAdsStateSignature(body, stateSecret)}`;
}

export function verifyAdsOAuthState(
  state: string,
  stateSecret: string,
  expected: AdsOAuthStateExpectation,
  now = Date.now()
): AdsOAuthStatePayload | null {
  const [body, signature, extra] = state.split('.');
  if (!body || !signature || extra) return null;
  if (
    !timingSafeStringEqual(
      signature,
      createAdsStateSignature(body, stateSecret)
    )
  ) {
    return null;
  }
  try {
    const payload = parsePayload(decodeJson(body));
    if (!payload) return null;
    const expectedRedirectUri = validateCanonicalAdsCallbackUri(
      expected.provider,
      expected.redirectUri
    );
    const ageSeconds = (now - payload.issuedAt) / 1000;
    if (
      ageSeconds < -30 ||
      ageSeconds > ADS_OAUTH_STATE_TTL_SECONDS ||
      payload.provider !== expected.provider ||
      (expected.merchantId !== null &&
        payload.merchantId !== expected.merchantId) ||
      payload.userId !== expected.userId ||
      payload.redirectUri !== expectedRedirectUri
    ) {
      return null;
    }
    validateCanonicalAdsCallbackUri(payload.provider, payload.redirectUri);
    return payload;
  } catch {
    return null;
  }
}
