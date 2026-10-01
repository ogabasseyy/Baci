import 'server-only';

import { z } from 'zod';
import type { MetaAdsConfig } from './config';
import { META_ADS_GRAPH_VERSION, META_ADS_SCOPE } from './constants';

export const META_ADS_AUTHORIZATION_ENDPOINT = `https://www.facebook.com/${META_ADS_GRAPH_VERSION}/dialog/oauth`;
export const META_ADS_GRAPH_ROOT = `https://graph.facebook.com/${META_ADS_GRAPH_VERSION}`;

export class MetaAdsOAuthError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, status?: number) {
    super(code);
    this.code = code;
    this.name = 'MetaAdsOAuthError';
    this.status = status;
  }
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive().optional(),
  token_type: z.string().optional(),
});

export function buildMetaAdsAuthorizationUrl(
  config: Pick<MetaAdsConfig, 'appId' | 'redirectUri'>,
  state: string
): string {
  const url = new URL(META_ADS_AUTHORIZATION_ENDPOINT);
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', META_ADS_SCOPE);
  url.searchParams.set('state', state);
  return url.toString();
}

async function readTokenResponse(
  response: Response,
  failureCode: string
): Promise<z.infer<typeof tokenResponseSchema>> {
  if (!response.ok) throw new MetaAdsOAuthError(failureCode, response.status);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MetaAdsOAuthError(
      'META_ADS_TOKEN_RESPONSE_INVALID',
      response.status
    );
  }
  const parsed = tokenResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new MetaAdsOAuthError(
      'META_ADS_TOKEN_RESPONSE_INVALID',
      response.status
    );
  }
  return parsed.data;
}

export async function exchangeMetaAdsAuthorizationCode(
  input: Pick<MetaAdsConfig, 'appId' | 'appSecret' | 'redirectUri'> & {
    code: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<z.infer<typeof tokenResponseSchema>> {
  const url = new URL(`${META_ADS_GRAPH_ROOT}/oauth/access_token`);
  url.searchParams.set('client_id', input.appId);
  url.searchParams.set('client_secret', input.appSecret);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('code', input.code);
  return readTokenResponse(
    await fetchImpl(url),
    'META_ADS_TOKEN_EXCHANGE_FAILED'
  );
}

export async function exchangeMetaAdsLongLivedToken(
  input: Pick<MetaAdsConfig, 'appId' | 'appSecret'> & { accessToken: string },
  fetchImpl: typeof fetch = fetch
): Promise<z.infer<typeof tokenResponseSchema> & { expires_in: number }> {
  const url = new URL(`${META_ADS_GRAPH_ROOT}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', input.appId);
  url.searchParams.set('client_secret', input.appSecret);
  url.searchParams.set('fb_exchange_token', input.accessToken);
  const token = await readTokenResponse(
    await fetchImpl(url),
    'META_ADS_LONG_LIVED_TOKEN_EXCHANGE_FAILED'
  );
  if (!token.expires_in) {
    throw new MetaAdsOAuthError('META_ADS_TOKEN_RESPONSE_INVALID');
  }
  return { ...token, expires_in: token.expires_in };
}
