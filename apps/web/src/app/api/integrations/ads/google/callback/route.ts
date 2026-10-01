import { type NextRequest, NextResponse } from 'next/server';
import { invalidateAdsAnalyticsCache } from '@/lib/ads/analytics-cache';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import { createAdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import { getGoogleAdsOAuthConfig } from '@/lib/google-ads/config';
import {
  GOOGLE_ADS_STATE_COOKIE,
  GOOGLE_ADS_VERIFIER_COOKIE,
} from '@/lib/google-ads/constants';
import {
  constantTimeStringEqual,
  encryptGoogleAdsSecret,
} from '@/lib/google-ads/crypto';
import {
  exchangeGoogleAdsAuthorizationCode,
  GoogleAdsOAuthError,
  verifyGoogleAdsOAuthState,
} from '@/lib/google-ads/oauth';
import { googleAdsOAuthCallbackQuerySchema } from '@/schemas/google-ads';

function clearOAuthCookies(response: NextResponse): NextResponse {
  const options = {
    httpOnly: true,
    maxAge: 0,
    path: '/api/integrations/ads/google',
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
  response.cookies.set(GOOGLE_ADS_STATE_COOKIE, '', options);
  response.cookies.set(GOOGLE_ADS_VERIFIER_COOKIE, '', options);
  return response;
}

function callbackRedirect(
  result: 'connected' | 'error',
  reason?: string,
  merchantId?: string
): NextResponse {
  // Never reflect the Host header from an OAuth callback. Google redirects to
  // the registered production origin, and all callback outcomes return to the
  // canonical Baci dashboard origin.
  const target = new URL('https://usebaci.com/dashboard/analytics');
  target.searchParams.set('google_ads', result);
  target.searchParams.set('category', 'ads');
  if (reason) target.searchParams.set('reason', reason);
  if (merchantId) target.searchParams.set('merchantId', merchantId);
  if (result === 'connected') {
    target.searchParams.set('cacheBust', String(Math.floor(Date.now() / 1000)));
  }
  const response = clearOAuthCookies(NextResponse.redirect(target));
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }

  const parsedQuery = googleAdsOAuthCallbackQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  if (!parsedQuery.success) {
    return callbackRedirect('error', 'invalid_callback');
  }

  let config: ReturnType<typeof getGoogleAdsOAuthConfig>;
  try {
    config = getGoogleAdsOAuthConfig();
  } catch (error) {
    if (error instanceof Error && error.name === 'GoogleAdsConfigError') {
      return callbackRedirect('error', 'not_configured');
    }
    return callbackRedirect('error', 'unavailable');
  }

  const state = parsedQuery.data.state;
  const storedState = request.cookies.get(GOOGLE_ADS_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(GOOGLE_ADS_VERIFIER_COOKIE)?.value;
  if (
    !state ||
    !storedState ||
    !verifier ||
    !constantTimeStringEqual(state, storedState)
  ) {
    return callbackRedirect('error', 'invalid_state');
  }

  const statePayload = verifyGoogleAdsOAuthState(
    state,
    config.oauthStateSecret
  );
  if (!statePayload || statePayload.userId !== auth.user.id) {
    return callbackRedirect('error', 'invalid_state');
  }
  const callbackMerchantId = statePayload.merchantId;

  const merchant = await resolveAdsMerchantAccess({
    merchantId: statePayload.merchantId,
    request,
    supabase: auth.supabase,
    userId: auth.user.id,
  });
  if (merchant.response || !merchant.access) {
    return callbackRedirect('error', 'merchant_mismatch', callbackMerchantId);
  }
  const access = merchant.access;
  if (!hasPermission(access, 'integrations', 'manage')) {
    return callbackRedirect('error', 'forbidden', callbackMerchantId);
  }

  const { data: nonceConsumed, error: nonceConsumeError } =
    await auth.supabase.rpc('consume_merchant_ads_oauth_state_nonce', {
      p_merchant_id: access.merchantId,
      p_nonce: statePayload.nonce,
      p_provider: 'google_ads',
      p_redirect_uri: config.redirectUri,
      p_user_id: auth.user.id,
    });
  if (nonceConsumeError || !nonceConsumed) {
    return callbackRedirect('error', 'invalid_state', callbackMerchantId);
  }

  if (parsedQuery.data.error) {
    return callbackRedirect('error', 'provider_denied', callbackMerchantId);
  }
  if (!parsedQuery.data.code) {
    return callbackRedirect('error', 'missing_code', callbackMerchantId);
  }

  let tokens: Awaited<ReturnType<typeof exchangeGoogleAdsAuthorizationCode>>;
  try {
    tokens = await exchangeGoogleAdsAuthorizationCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code: parsedQuery.data.code,
      codeVerifier: verifier,
      redirectUri: config.redirectUri,
    });
  } catch (error) {
    if (error instanceof GoogleAdsOAuthError) {
      return callbackRedirect(
        'error',
        error.code.toLowerCase(),
        callbackMerchantId
      );
    }
    return callbackRedirect(
      'error',
      'token_exchange_failed',
      callbackMerchantId
    );
  }

  // The authorization request always uses prompt=consent and offline access.
  // Never combine a new identity's access token with an older grant's refresh
  // token when Google omits refresh_token from the response.
  const refreshTokenCiphertext = tokens.refresh_token
    ? encryptGoogleAdsSecret(tokens.refresh_token, config.tokenEncryptionKey)
    : null;
  if (!refreshTokenCiphertext) {
    return callbackRedirect(
      'error',
      'offline_access_required',
      callbackMerchantId
    );
  }

  const tokenExpiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;
  // Credential RPCs are service-role-only. The user-scoped client remains the
  // authority for nonce consumption, while this client is created only after
  // authentication, merchant resolution, and integrations:manage checks.
  const credentialSupabase = createAdsCredentialServiceClient();
  const { error: upsertError } = await credentialSupabase.rpc(
    'upsert_google_ads_connection',
    {
      p_access_token_ciphertext: encryptGoogleAdsSecret(
        tokens.access_token,
        config.tokenEncryptionKey
      ),
      p_merchant_id: access.merchantId,
      // Reauthorization may have switched Google identities or manager
      // accounts. Require the merchant to confirm the reporting customer
      // instead of silently carrying forward a stale selection.
      p_provider_customer_id: null,
      p_refresh_token_ciphertext: refreshTokenCiphertext,
      p_scopes: tokens.scope?.split(/\s+/).filter(Boolean) ?? [],
      p_status: 'active',
      p_token_expires_at: tokenExpiresAt,
    }
  );
  if (upsertError) {
    return callbackRedirect(
      'error',
      'connection_write_failed',
      callbackMerchantId
    );
  }

  invalidateAdsAnalyticsCache(access.merchantId);
  return callbackRedirect('connected', undefined, access.merchantId);
}
