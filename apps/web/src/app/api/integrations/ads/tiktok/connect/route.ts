import { type NextRequest, NextResponse } from 'next/server';
import { generateAdsRandomValue } from '@/lib/ads/crypto';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import { createAdsOAuthState } from '@/lib/ads/state';
import {
  getTikTokAdsConfig,
  TIKTOK_ADS_CONFIG_MISSING,
  TikTokAdsConfigError,
} from '@/lib/ads/tiktok/config';
import {
  TIKTOK_ADS_OAUTH_COOKIE_MAX_AGE,
  TIKTOK_ADS_PROVIDER,
  TIKTOK_ADS_STATE_COOKIE,
} from '@/lib/ads/tiktok/constants';
import { buildTikTokAdsAuthorizationUrl } from '@/lib/ads/tiktok/oauth';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';

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
  try {
    const config = getTikTokAdsConfig();
    const nonce = generateAdsRandomValue(24);
    const state = createAdsOAuthState(
      {
        merchantId: access.merchantId,
        nonce,
        provider: TIKTOK_ADS_PROVIDER,
        redirectUri: config.redirectUri,
        userId: auth.user.id,
      },
      config.oauthStateSecret
    );
    const { data: nonceReserved, error: nonceReserveError } =
      await auth.supabase.rpc('reserve_merchant_ads_oauth_state_nonce', {
        p_expires_at: new Date(
          Date.now() + TIKTOK_ADS_OAUTH_COOKIE_MAX_AGE * 1000
        ).toISOString(),
        p_merchant_id: access.merchantId,
        p_nonce: nonce,
        p_provider: TIKTOK_ADS_PROVIDER,
        p_redirect_uri: config.redirectUri,
        p_user_id: auth.user.id,
      });
    if (nonceReserveError || !nonceReserved)
      return NextResponse.json(
        { error: 'TikTok Ads integration unavailable' },
        { status: 503 }
      );
    const authorizationUrl = buildTikTokAdsAuthorizationUrl(config, state);
    const response = request.headers.get('accept')?.includes('application/json')
      ? NextResponse.json({ authorizationUrl })
      : NextResponse.redirect(authorizationUrl);
    response.cookies.set(TIKTOK_ADS_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: TIKTOK_ADS_OAUTH_COOKIE_MAX_AGE,
      path: '/api/integrations/ads/tiktok',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof TikTokAdsConfigError
            ? TIKTOK_ADS_CONFIG_MISSING
            : 'TikTok Ads integration unavailable',
      },
      { status: 503 }
    );
  }
}
