import 'server-only';

import type { AdsCredentialServiceClient } from '@/lib/ads/server-credential-client';

export function getGoogleAdsReauthReason(error: unknown): string | null {
  const record =
    error !== null && typeof error === 'object'
      ? (error as { code?: unknown; status?: unknown })
      : null;
  const code =
    record && typeof record.code === 'string'
      ? record.code
      : error instanceof Error
        ? error.message
        : null;
  const status = record?.status;
  if (
    code === 'GOOGLE_ADS_ACCESS_TOKEN_DECRYPT_FAILED' ||
    code === 'GOOGLE_ADS_REFRESH_TOKEN_DECRYPT_FAILED' ||
    code === 'GOOGLE_ADS_REFRESH_TOKEN_MISSING'
  )
    return code;
  return code === 'GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED' &&
    (status === undefined || status === null || status === 400)
    ? code
    : null;
}

export async function persistGoogleAdsReauthRequired(input: {
  connection: {
    access_token_ciphertext: string | null;
    refresh_token_ciphertext: string | null;
  };
  credentialSupabase: AdsCredentialServiceClient;
  merchantId: string;
  reason: string;
}): Promise<boolean> {
  const { data, error } = await input.credentialSupabase.rpc(
    'mark_google_ads_connection_reauth_if_current',
    {
      p_access_token_ciphertext: input.connection.access_token_ciphertext,
      p_merchant_id: input.merchantId,
      p_reason: input.reason,
      p_refresh_token_ciphertext: input.connection.refresh_token_ciphertext,
    }
  );
  return !error && data === true;
}
