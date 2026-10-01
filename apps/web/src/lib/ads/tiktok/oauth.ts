import 'server-only';

import { z } from 'zod';
import type { TikTokAdsConfig } from './config';
import { TIKTOK_ADS_API_ROOT } from './constants';
import { tiktokAdsProviderRateLimiter } from './rate-limit';

export class TikTokAdsOAuthError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, status?: number) {
    super(code);
    this.code = code;
    this.name = 'TikTokAdsOAuthError';
    this.status = status;
  }
}

const tokenPayloadSchema = z.object({
  code: z.union([z.literal(0), z.literal('0')]),
  data: z.object({
    access_token: z.string().min(1),
    advertiser_ids: z.array(z.string().trim().min(1).max(255)).min(1),
    scope: z
      .array(
        z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
      )
      .default([]),
  }),
});

export interface TikTokAdsGrant {
  accessToken: string;
  advertiserIds: string[];
  scopes: string[];
}

export function buildTikTokAdsAuthorizationUrl(
  config: Pick<TikTokAdsConfig, 'appId' | 'authorizationUrl' | 'redirectUri'>,
  state: string
): string {
  const url = new URL(config.authorizationUrl);
  // The configured app ID is the source of truth. This also replaces a stale
  // app_id embedded in an older authorization URL instead of binding the
  // consent request to a different TikTok app than the token exchange.
  url.searchParams.set('app_id', config.appId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeTikTokAdsAuthorizationCode(
  input: Pick<TikTokAdsConfig, 'appId' | 'appSecret'> & { code: string },
  fetchImpl: typeof fetch = fetch,
  acquire: () => Promise<void> = () => tiktokAdsProviderRateLimiter.acquire()
): Promise<TikTokAdsGrant> {
  await acquire();
  const response = await fetchImpl(
    `${TIKTOK_ADS_API_ROOT}/oauth2/access_token/`,
    {
      body: JSON.stringify({
        app_id: input.appId,
        auth_code: input.code,
        secret: input.appSecret,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }
  );
  if (!response.ok)
    throw new TikTokAdsOAuthError(
      'TIKTOK_ADS_TOKEN_EXCHANGE_FAILED',
      response.status
    );
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new TikTokAdsOAuthError(
      'TIKTOK_ADS_TOKEN_RESPONSE_INVALID',
      response.status
    );
  }
  const parsed = tokenPayloadSchema.safeParse(payload);
  if (!parsed.success)
    throw new TikTokAdsOAuthError(
      'TIKTOK_ADS_TOKEN_RESPONSE_INVALID',
      response.status
    );
  return {
    accessToken: parsed.data.data.access_token,
    advertiserIds: parsed.data.data.advertiser_ids,
    scopes: parsed.data.data.scope.map(String),
  };
}
