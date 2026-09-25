/**
 * Jumia Vendor Center API — Auth helpers
 *
 * Handles OAuth URL generation, code exchange, and environment config.
 * Matches Postman collection: GET {{baseUrl}}/login, POST {{baseUrl}}/token
 */

import { ZodError } from 'zod';
import { getJumiaEnvironment as readJumiaEnvironment } from '@/env';
import { JumiaApiError } from '@/lib/jumia/jumia-api-error';
import type { JumiaTokenResponse } from '@/schemas/jumia';
import { JumiaTokenResponseSchema } from '@/schemas/jumia';

// ── Environment ──

export type JumiaEnvironment = 'staging' | 'production';

const BASE_URLS: Record<JumiaEnvironment, string> = {
  staging: 'https://vendor-api-staging.jumia.com',
  production: 'https://vendor-api.jumia.com',
};

export function getJumiaEnvironment(): JumiaEnvironment {
  return readJumiaEnvironment() ?? 'staging';
}

export function getJumiaBaseUrl(env?: JumiaEnvironment): string {
  return BASE_URLS[env ?? getJumiaEnvironment()];
}

// ── Token refresh buffer ──

export const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ── OAuth: Authorization URL ──

// VARIANT-TEST: REMOVE — diagnostic harness for refresh_token issuance hypothesis.
// Each ID maps to a different OAuth auth-URL parameter combination; the connect
// route reads ?variant=<id> from the request and threads it into getJumiaAuthUrl,
// the callback logs the resulting token-response shape so we can A/B which combo
// (if any) makes Jumia mint refresh tokens. Drop this whole block + getJumiaAuthUrl's
// `variant` arg + the cookie in connect/callback once we have an answer.
type JumiaAuthUrlVariant = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

const DEFAULT_AUTH_PARAMS: Record<string, string> = {
  scope: 'openid offline_access',
  prompt: 'login',
  max_age: '0',
};

const VARIANT_AUTH_PARAMS: Record<
  JumiaAuthUrlVariant,
  Record<string, string>
> = {
  // A: drop max_age=0 (added by PR #990 for forced re-auth; might suppress refresh)
  A: { scope: 'openid offline_access', prompt: 'login' },
  // B: prompt=consent (some IdPs only mint refresh tokens after explicit consent)
  B: { scope: 'openid offline_access', prompt: 'consent', max_age: '0' },
  // C: scope reorder (some IdPs are order-sensitive)
  C: { scope: 'offline_access openid', prompt: 'login', max_age: '0' },
  // D: drop openid scope entirely — request only offline_access
  D: { scope: 'offline_access', prompt: 'login', max_age: '0' },
  // E: combined — drop max_age and switch to consent
  E: { scope: 'openid offline_access', prompt: 'consent' },
  // F: exact parameter set in Jumia's published authorization documentation.
  F: { scope: 'openid', prompt: 'login' },
};

export function isJumiaAuthUrlVariant(
  value: string | null | undefined
): value is JumiaAuthUrlVariant {
  return (
    value === 'A' ||
    value === 'B' ||
    value === 'C' ||
    value === 'D' ||
    value === 'E' ||
    value === 'F'
  );
}

export function getJumiaAuthUrl(config: {
  clientId: string;
  redirectUri: string;
  state: string;
  environment?: JumiaEnvironment;
  // VARIANT-TEST: REMOVE — diagnostic only. Default behavior unchanged when omitted.
  variant?: JumiaAuthUrlVariant;
}): string {
  const baseUrl = getJumiaBaseUrl(config.environment);
  const variantParams = config.variant
    ? VARIANT_AUTH_PARAMS[config.variant]
    : DEFAULT_AUTH_PARAMS;
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    state: config.state,
    ...variantParams,
  });
  return `${baseUrl}/login?${params.toString()}`;
}

export function getJumiaRedirectUri(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/api/marketplace/jumia/callback`;
}

// ── OAuth: Code exchange ──

export { JumiaApiError } from '@/lib/jumia/jumia-api-error';

function redactJumiaErrorDetails(raw: string): string {
  return raw
    .replace(
      /"(access_token|refresh_token|client_secret|code)"\s*:\s*"[^"]*"/gi,
      '"$1":"[REDACTED]"'
    )
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(
      /(^|[?&])(access_token|refresh_token|client_secret|code)=[^&\s"]*/gi,
      '$1$2=[REDACTED]'
    );
}

function safeStringifyJumiaErrorDetails(details: unknown): string {
  if (typeof details === 'string') {
    return details;
  }

  const seen = new WeakSet<object>();

  try {
    const stringified = JSON.stringify(
      details,
      (_key, value: unknown) => {
        if (typeof value === 'bigint') {
          return value.toString();
        }

        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }

        return value;
      },
      2
    );

    if (typeof stringified === 'string') {
      return stringified;
    }
  } catch {
    // Fall through to String(details)
  }

  return String(details);
}

export function sanitizeJumiaErrorDetails(
  details: unknown,
  maxLength = 1_000
): unknown {
  if (details == null) {
    return undefined;
  }

  const raw = safeStringifyJumiaErrorDetails(details);
  const redacted = redactJumiaErrorDetails(raw);

  if (redacted.length > maxLength) {
    return `${redacted.slice(0, maxLength)}...[truncated]`;
  }

  try {
    return JSON.parse(redacted) as unknown;
  } catch {
    return redacted;
  }
}

export async function exchangeJumiaCode(config: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment?: JumiaEnvironment;
}): Promise<JumiaTokenResponse> {
  const baseUrl = getJumiaBaseUrl(config.environment);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: config.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new JumiaApiError(response.status, 'Token exchange failed', body);
    }

    // Jumia Vendor Center may return access-token-only responses (no refresh_token).
    // The schema marks it optional and storage paths persist null. Do not add a
    // runtime throw here: access-token-only OAuth responses are valid, and adding
    // a throw regresses the mobile/web Jumia connect flow.
    return JumiaTokenResponseSchema.parse(await response.json());
  } catch (error) {
    if (error instanceof JumiaApiError) throw error;
    if (
      (error instanceof Error || error instanceof DOMException) &&
      error.name === 'AbortError'
    ) {
      throw new JumiaApiError(408, 'Token exchange request timed out');
    }
    if (error instanceof ZodError) {
      throw new JumiaApiError(502, 'Invalid token response from Jumia', error);
    }
    throw new JumiaApiError(500, 'Token exchange failed unexpectedly', error);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Shared API error response helper ──

/**
 * Converts a JumiaApiError into a JSON Response with the appropriate HTTP status.
 * Preserves meaningful Jumia API status codes (400-599), falls back to 500.
 */
export function jumiaErrorResponse(err: JumiaApiError): Response {
  const safeDetails = sanitizeJumiaErrorDetails(err.details);
  console.error('[Jumia API]', {
    message: err.message,
    details: safeDetails,
    stack: err.stack,
  });
  const status = err.status >= 400 && err.status < 600 ? err.status : 500;
  return Response.json({ error: 'Jumia API error' }, { status });
}
