import { type NextRequest, NextResponse } from 'next/server';
import { generateAdsRandomValue } from '@/lib/ads/crypto';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import {
  getMetaAdsConfig,
  META_ADS_CONFIG_MISSING,
  MetaAdsConfigError,
} from '@/lib/ads/meta/config';
import {
  META_ADS_OAUTH_COOKIE_MAX_AGE,
  META_ADS_PROVIDER,
  META_ADS_STATE_COOKIE,
} from '@/lib/ads/meta/constants';
import { buildMetaAdsAuthorizationUrl } from '@/lib/ads/meta/oauth';
import { createAdsOAuthState } from '@/lib/ads/state';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';

function cookieOptions() {
  return {
    httpOnly: true,
    maxAge: META_ADS_OAUTH_COOKIE_MAX_AGE,
    path: '/api/integrations/ads/meta',
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  const merchant = await resolveAdsMerchantAccess({
    request,
    source: 'query',
    supabase: auth.supabase,
    userId: auth.user.id,
  });
  if (merchant.response) return merchant.response;
  const access = merchant.access;
  if (!access)
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  if (!hasPermission(access, 'integrations', 'manage'))
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  let config: ReturnType<typeof getMetaAdsConfig>;
  try {
    config = getMetaAdsConfig();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof MetaAdsConfigError
            ? META_ADS_CONFIG_MISSING
            : 'Meta Ads integration unavailable',
      },
      { status: 503 }
    );
  }
  const nonce = generateAdsRandomValue(24);
  const state = createAdsOAuthState(
    {
      merchantId: access.merchantId,
      nonce,
      provider: META_ADS_PROVIDER,
      redirectUri: config.redirectUri,
      userId: auth.user.id,
    },
    config.oauthStateSecret
  );
  const { data: nonceReserved, error: nonceReserveError } =
    await auth.supabase.rpc('reserve_merchant_ads_oauth_state_nonce', {
      p_expires_at: new Date(
        Date.now() + META_ADS_OAUTH_COOKIE_MAX_AGE * 1000
      ).toISOString(),
      p_merchant_id: access.merchantId,
      p_nonce: nonce,
      p_provider: META_ADS_PROVIDER,
      p_redirect_uri: config.redirectUri,
      p_user_id: auth.user.id,
    });
  if (nonceReserveError || !nonceReserved)
    return NextResponse.json(
      { error: 'Meta Ads integration unavailable' },
      { status: 503 }
    );
  const authorizationUrl = buildMetaAdsAuthorizationUrl(config, state);
  const response = request.headers.get('accept')?.includes('application/json')
    ? NextResponse.json({ authorizationUrl })
    : NextResponse.redirect(authorizationUrl);
  response.cookies.set(META_ADS_STATE_COOKIE, state, cookieOptions());
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
