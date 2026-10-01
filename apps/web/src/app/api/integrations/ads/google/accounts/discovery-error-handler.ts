import 'server-only';

import { NextResponse } from 'next/server';
import type { AdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import { GoogleAdsProviderError } from '@/lib/google-ads/provider';
import { persistGoogleAdsReauthRequired } from '@/lib/google-ads/reauth';
import { accountDiscoveryErrorResponse } from './discovery-error-response';

interface GoogleAdsConnectionSecret {
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
}

export async function handleGoogleAdsAccountDiscoveryError(input: {
  connection: GoogleAdsConnectionSecret;
  credentialSupabase: AdsCredentialServiceClient;
  error: unknown;
  merchantId: string;
}): Promise<NextResponse> {
  if (
    input.error instanceof GoogleAdsProviderError &&
    input.error.status === 401 &&
    !(await persistGoogleAdsReauthRequired({
      connection: input.connection,
      credentialSupabase: input.credentialSupabase,
      merchantId: input.merchantId,
      reason: 'GOOGLE_ADS_ACCESS_REVOKED',
    }))
  ) {
    return NextResponse.json(
      { error: 'Failed to update Google Ads authorization status' },
      { status: 500 }
    );
  }

  return accountDiscoveryErrorResponse(input.error);
}
