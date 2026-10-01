import 'server-only';

import { decryptAdsToken, encryptAdsToken } from '@/lib/ads/crypto';
import type { AdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import type { SnapchatAdsConfig } from './config';
import { SNAPCHAT_ADS_PROVIDER } from './constants';
import { refreshSnapchatAdsAccessToken, type SnapchatAdsGrant } from './oauth';

const SNAPCHAT_ADS_TOKEN_REFRESH_SAFETY_WINDOW_MS = 60_000;

export interface SnapchatAdsEncryptedConnection {
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
}
export interface SnapchatAdsUsableGrant {
  accessToken: string;
  accessTokenCiphertext: string | null;
  refreshTokenCiphertext: string | null;
  tokenExpiresAt: string | null;
}
export function resolveSnapchatAdsAccessToken(
  connection: SnapchatAdsEncryptedConnection,
  config: SnapchatAdsConfig
): string {
  if (!connection.access_token_ciphertext)
    throw new Error('SNAPCHAT_ADS_REAUTH_REQUIRED');
  try {
    return decryptAdsToken(
      connection.access_token_ciphertext,
      config.tokenEncryptionKey,
      SNAPCHAT_ADS_PROVIDER
    );
  } catch {
    throw new Error('SNAPCHAT_ADS_ACCESS_TOKEN_DECRYPT_FAILED');
  }
}

export function resolveSnapchatAdsRefreshToken(
  connection: SnapchatAdsEncryptedConnection,
  config: SnapchatAdsConfig
): string {
  if (!connection.refresh_token_ciphertext)
    throw new Error('SNAPCHAT_ADS_REAUTH_REQUIRED');
  try {
    return decryptAdsToken(
      connection.refresh_token_ciphertext,
      config.tokenEncryptionKey,
      SNAPCHAT_ADS_PROVIDER
    );
  } catch {
    throw new Error('SNAPCHAT_ADS_REFRESH_TOKEN_DECRYPT_FAILED');
  }
}

export class SnapchatAdsTokenRefreshError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SnapchatAdsTokenRefreshError';
  }
}

export async function getSnapchatAdsUsableGrant(input: {
  config: SnapchatAdsConfig;
  connection: SnapchatAdsEncryptedConnection;
  credentialSupabase: AdsCredentialServiceClient;
  merchantId: string;
}): Promise<SnapchatAdsUsableGrant> {
  const expiresAt = input.connection.token_expires_at
    ? Date.parse(input.connection.token_expires_at)
    : Number.NaN;

  // Resolve the access token only when its expiry proves it can be returned.
  // Missing or stale expiry metadata must take the refresh path, even when the
  // stored access ciphertext is unreadable.
  if (
    input.connection.access_token_ciphertext &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now() + SNAPCHAT_ADS_TOKEN_REFRESH_SAFETY_WINDOW_MS
  ) {
    try {
      const token = resolveSnapchatAdsAccessToken(
        input.connection,
        input.config
      );
      return {
        accessToken: token,
        accessTokenCiphertext: input.connection.access_token_ciphertext,
        refreshTokenCiphertext: input.connection.refresh_token_ciphertext,
        tokenExpiresAt: input.connection.token_expires_at,
      };
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== 'SNAPCHAT_ADS_ACCESS_TOKEN_DECRYPT_FAILED'
      )
        throw error;
      // An unreadable access token can still be recovered while its refresh
      // grant remains usable. Fall through to the refresh path instead of
      // keeping the connection active until the stale expiry metadata passes.
    }
  }
  if (!input.connection.refresh_token_ciphertext)
    throw new SnapchatAdsTokenRefreshError('SNAPCHAT_ADS_REFRESH_REJECTED');
  let grant: SnapchatAdsGrant;
  try {
    grant = await refreshSnapchatAdsAccessToken({
      ...input.config,
      refreshToken: resolveSnapchatAdsRefreshToken(
        input.connection,
        input.config
      ),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'SNAPCHAT_ADS_REFRESH_TOKEN_DECRYPT_FAILED'
    )
      throw new SnapchatAdsTokenRefreshError(error.message);
    const status =
      error &&
      typeof error === 'object' &&
      typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : undefined;
    throw new SnapchatAdsTokenRefreshError(
      status === 400 || status === 401 || status === 403
        ? 'SNAPCHAT_ADS_REFRESH_REJECTED'
        : 'SNAPCHAT_ADS_REFRESH_FAILED'
    );
  }
  const accessTokenCiphertext = encryptAdsToken(
    grant.accessToken,
    input.config.tokenEncryptionKey,
    SNAPCHAT_ADS_PROVIDER
  );
  const refreshTokenCiphertext = encryptAdsToken(
    grant.refreshToken,
    input.config.tokenEncryptionKey,
    SNAPCHAT_ADS_PROVIDER
  );
  const tokenExpiresAt = new Date(
    Date.now() + grant.expiresIn * 1000
  ).toISOString();
  const updated = await input.credentialSupabase.rpc(
    'update_snapchat_ads_connection_tokens',
    {
      p_access_token_ciphertext: accessTokenCiphertext,
      p_current_refresh_token_ciphertext:
        input.connection.refresh_token_ciphertext,
      p_merchant_id: input.merchantId,
      p_refresh_token_ciphertext: refreshTokenCiphertext,
      p_token_expires_at: tokenExpiresAt,
    }
  );
  if (updated.error || updated.data !== true)
    throw new SnapchatAdsTokenRefreshError(
      'SNAPCHAT_ADS_TOKEN_REFRESH_WRITE_FAILED'
    );
  return {
    accessToken: grant.accessToken,
    accessTokenCiphertext,
    refreshTokenCiphertext,
    tokenExpiresAt,
  };
}

export async function getSnapchatAdsUsableAccessToken(input: {
  config: SnapchatAdsConfig;
  connection: SnapchatAdsEncryptedConnection;
  credentialSupabase: AdsCredentialServiceClient;
  merchantId: string;
}): Promise<string> {
  return (await getSnapchatAdsUsableGrant(input)).accessToken;
}
