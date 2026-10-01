import 'server-only';

import { z } from 'zod';
import type { SnapchatAdsConfig } from './config';
import {
  SNAPCHAT_ADS_AUTHORIZE_URL,
  SNAPCHAT_ADS_SCOPE,
  SNAPCHAT_ADS_TOKEN_URL,
} from './constants';
import { SnapchatAdsProviderError } from './request';

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
  refresh_token: z.string().min(1),
  scope: z.string().optional(),
});
export interface SnapchatAdsGrant {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  scopes: string[];
}
export function buildSnapchatAdsAuthorizationUrl(
  config: Pick<SnapchatAdsConfig, 'clientId' | 'redirectUri'>,
  state: string
): string {
  const url = new URL(SNAPCHAT_ADS_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SNAPCHAT_ADS_SCOPE);
  url.searchParams.set('state', state);
  return url.toString();
}
async function exchange(
  body: URLSearchParams,
  fetchImpl: typeof fetch
): Promise<SnapchatAdsGrant> {
  const response = await fetchImpl(SNAPCHAT_ADS_TOKEN_URL, {
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  if (!response.ok)
    throw new SnapchatAdsProviderError(
      'SNAPCHAT_ADS_TOKEN_EXCHANGE_FAILED',
      response.status
    );
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SnapchatAdsProviderError(
      'SNAPCHAT_ADS_TOKEN_RESPONSE_INVALID',
      response.status
    );
  }
  const parsed = tokenSchema.safeParse(payload);
  if (!parsed.success)
    throw new SnapchatAdsProviderError(
      'SNAPCHAT_ADS_TOKEN_RESPONSE_INVALID',
      response.status
    );
  return {
    accessToken: parsed.data.access_token,
    expiresIn: parsed.data.expires_in,
    refreshToken: parsed.data.refresh_token,
    scopes: (parsed.data.scope ?? SNAPCHAT_ADS_SCOPE)
      .split(/\s+/)
      .filter(Boolean),
  };
}
export function exchangeSnapchatAdsAuthorizationCode(
  input: Pick<
    SnapchatAdsConfig,
    'clientId' | 'clientSecret' | 'redirectUri'
  > & { code: string },
  fetchImpl: typeof fetch = fetch
) {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
  });
  return exchange(body, fetchImpl);
}
export function refreshSnapchatAdsAccessToken(
  input: Pick<
    SnapchatAdsConfig,
    'clientId' | 'clientSecret' | 'redirectUri'
  > & { refreshToken: string },
  fetchImpl: typeof fetch = fetch
) {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
    redirect_uri: input.redirectUri,
    refresh_token: input.refreshToken,
  });
  return exchange(body, fetchImpl);
}
