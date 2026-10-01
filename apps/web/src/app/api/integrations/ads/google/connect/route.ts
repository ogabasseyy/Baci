import { type NextRequest, NextResponse } from 'next/server';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import {
  GOOGLE_ADS_CONFIG_MISSING,
  getGoogleAdsOAuthConfig,
} from '@/lib/google-ads/config';
import {
  GOOGLE_ADS_OAUTH_COOKIE_MAX_AGE,
  GOOGLE_ADS_STATE_COOKIE,
  GOOGLE_ADS_VERIFIER_COOKIE,
} from '@/lib/google-ads/constants';
import {
  buildGoogleAdsAuthorizationUrl,
  createGoogleAdsOAuthState,
  createGoogleAdsPkcePair,
} from '@/lib/google-ads/oauth';

function cookieOptions() {
  return {
    httpOnly: true,
    maxAge: GOOGLE_ADS_OAUTH_COOKIE_MAX_AGE,
    path: '/api/integrations/ads/google',
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }

  const merchant = await resolveAdsMerchantAccess({
    request,
    source: 'query',
    supabase: auth.supabase,
    userId: auth.user.id,
  });
  if (merchant.response) return merchant.response;
  const access = merchant.access;
  if (!access) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }
  if (!hasPermission(access, 'integrations', 'manage')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  let config: ReturnType<typeof getGoogleAdsOAuthConfig>;
  try {
    config = getGoogleAdsOAuthConfig();
  } catch (error) {
    if (error instanceof Error && error.name === 'GoogleAdsConfigError') {
      return NextResponse.json(
        { error: GOOGLE_ADS_CONFIG_MISSING },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: 'Google Ads integration unavailable' },
      { status: 503 }
    );
  }

  const pkce = createGoogleAdsPkcePair();
  const state = createGoogleAdsOAuthState(
    {
      merchantId: access.merchantId,
      nonce: pkce.verifier.slice(0, 16),
      userId: auth.user.id,
    },
    config.oauthStateSecret
  );
  const { data: nonceReserved, error: nonceReserveError } =
    await auth.supabase.rpc('reserve_merchant_ads_oauth_state_nonce', {
      p_expires_at: new Date(
        Date.now() + GOOGLE_ADS_OAUTH_COOKIE_MAX_AGE * 1000
      ).toISOString(),
      p_merchant_id: access.merchantId,
      p_nonce: pkce.verifier.slice(0, 16),
      p_provider: 'google_ads',
      p_redirect_uri: config.redirectUri,
      p_user_id: auth.user.id,
    });
  if (nonceReserveError || !nonceReserved) {
    return NextResponse.json(
      { error: 'Google Ads integration unavailable' },
      { status: 503 }
    );
  }
  const authorizationUrl = buildGoogleAdsAuthorizationUrl(config, state, pkce);
  const response = request.headers.get('accept')?.includes('application/json')
    ? NextResponse.json({ authorizationUrl })
    : NextResponse.redirect(authorizationUrl);
  response.cookies.set(GOOGLE_ADS_STATE_COOKIE, state, cookieOptions());
  response.cookies.set(
    GOOGLE_ADS_VERIFIER_COOKIE,
    pkce.verifier,
    cookieOptions()
  );
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
