import { NextResponse } from 'next/server';
import type { AdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import {
  getGoogleAdsReauthReason,
  persistGoogleAdsReauthRequired,
} from '@/lib/google-ads/reauth';

export async function tokenResolutionErrorResponse(input: {
  connection: {
    access_token_ciphertext: string | null;
    refresh_token_ciphertext: string | null;
  };
  credentialSupabase: AdsCredentialServiceClient;
  error: unknown;
  merchantId: string;
}): Promise<NextResponse> {
  const reason = getGoogleAdsReauthReason(input.error);
  if (
    reason &&
    !(await persistGoogleAdsReauthRequired({
      connection: input.connection,
      credentialSupabase: input.credentialSupabase,
      merchantId: input.merchantId,
      reason,
    }))
  ) {
    return NextResponse.json(
      { error: 'Failed to update Google Ads authorization status' },
      { status: 500 }
    );
  }
  return NextResponse.json(
    { error: 'Google Ads authorization expired' },
    { status: 502 }
  );
}
