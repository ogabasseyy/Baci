import { type NextRequest, NextResponse } from 'next/server';
import { generateAdsRandomValue } from '@/lib/ads/crypto';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import {
  getSnapchatAdsConfig,
  SnapchatAdsConfigError,
} from '@/lib/ads/snapchat/config';
import {
  SNAPCHAT_ADS_OAUTH_COOKIE_MAX_AGE,
  SNAPCHAT_ADS_PROVIDER,
  SNAPCHAT_ADS_STATE_COOKIE,
} from '@/lib/ads/snapchat/constants';
import { buildSnapchatAdsAuthorizationUrl } from '@/lib/ads/snapchat/oauth';
import { createAdsOAuthState } from '@/lib/ads/state';
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
    const config = getSnapchatAdsConfig();
    const nonce = generateAdsRandomValue(24);
    const state = createAdsOAuthState(
      {
        merchantId: access.merchantId,
        nonce,
        provider: SNAPCHAT_ADS_PROVIDER,
        redirectUri: config.redirectUri,
        userId: auth.user.id,
      },
      config.oauthStateSecret
    );
    const reserved = await auth.supabase.rpc(
      'reserve_snapchat_ads_oauth_state_nonce',
      {
        p_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        p_merchant_id: access.merchantId,
        p_nonce: nonce,
        p_redirect_uri: config.redirectUri,
        p_user_id: auth.user.id,
      }
    );
    if (reserved.error || reserved.data !== true)
      return NextResponse.json(
        { error: 'Snapchat Ads authorization unavailable' },
        { status: 503 }
      );
    const authorizationUrl = buildSnapchatAdsAuthorizationUrl(config, state);
    const response = request.headers
      ?.get('accept')
      ?.includes('application/json')
      ? NextResponse.json({ authorizationUrl })
      : NextResponse.redirect(authorizationUrl);
    response.cookies.set(SNAPCHAT_ADS_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: SNAPCHAT_ADS_OAUTH_COOKIE_MAX_AGE,
      path: '/api/integrations/ads/snapchat',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof SnapchatAdsConfigError
            ? 'Snapchat Ads integration is not configured'
            : 'Snapchat Ads integration unavailable',
      },
      { status: 503 }
    );
  }
}
