import { createHash } from 'node:crypto';
import type { JumiaTokenResponse } from '@/schemas/jumia';

const COOKIE_NAME = 'jumia_oauth_diagnostic';
const QUERY_VALUE = 'token-shape';
const STATE_PREFIX = 'jumia-diagnostic-';

function buildEvidence(tokens: JumiaTokenResponse) {
  const normalizedTokenType = tokens.token_type.trim().toLowerCase();

  return {
    expires_in: tokens.expires_in,
    has_access_token: Boolean(tokens.access_token),
    has_refresh_expires_in: tokens.refresh_expires_in !== undefined,
    has_refresh_token: Boolean(tokens.refresh_token),
    persistence_skipped: true,
    refresh_expires_in: tokens.refresh_expires_in ?? null,
    token_type: normalizedTokenType === 'bearer' ? 'bearer' : 'other',
  };
}

function buildRedirectQuery({
  diagnosticId,
  tokens,
  variant,
}: {
  diagnosticId: string;
  tokens: JumiaTokenResponse;
  variant?: string;
}): Record<string, string> {
  const evidence = buildEvidence(tokens);

  return {
    diagnostic_id: diagnosticId,
    expires_in: String(evidence.expires_in),
    has_access_token: String(evidence.has_access_token),
    has_refresh_expires_in: String(evidence.has_refresh_expires_in),
    has_refresh_token: String(evidence.has_refresh_token),
    jumia_diagnostic: 'complete',
    persistence_skipped: String(evidence.persistence_skipped),
    refresh_expires_in:
      evidence.refresh_expires_in === null
        ? 'null'
        : String(evidence.refresh_expires_in),
    token_type: evidence.token_type,
    variant: variant ?? 'default',
  };
}

function clientIdFingerprint(clientId: string): string {
  return createHash('sha256').update(clientId).digest('hex').slice(0, 12);
}

function hostnameOf(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function getAuthorizationEvidence(authorizationUrl: string) {
  const url = new URL(authorizationUrl);

  return {
    client_id_sha256_12: clientIdFingerprint(
      url.searchParams.get('client_id') ?? ''
    ),
    provider_host: url.hostname,
    requested_max_age: url.searchParams.get('max_age'),
    requested_prompt: url.searchParams.get('prompt'),
    requested_scope: url.searchParams.get('scope'),
    redirect_host: hostnameOf(url.searchParams.get('redirect_uri')),
    response_type: url.searchParams.get('response_type'),
  };
}

export const jumiaOAuthDiagnostic = {
  bindState(state: string, diagnosticRequested: boolean): string {
    return diagnosticRequested ? `${STATE_PREFIX}${state}` : state;
  },
  buildEvidence,
  buildRedirectQuery,
  cookieName: COOKIE_NAME,
  getAuthorizationEvidence,
  isRequested(searchParams: URLSearchParams): boolean {
    return searchParams.get('diagnostic') === QUERY_VALUE;
  },
  isStateBound(state: string): boolean {
    return state.startsWith(STATE_PREFIX);
  },
};
