import {
  FB_APP_ID,
  FB_CLIENT_TOKEN,
  type getAdTrackingModules,
  IS_TIKTOK_BUSINESS_CONFIGURED,
} from './ad-tracking-state';

export function isFacebookTrackingConfigured(): boolean {
  return Boolean(FB_APP_ID && FB_CLIENT_TOKEN);
}

/**
 * TikTok import failure must not block Facebook ATT when Facebook modules loaded.
 */
export function hasRequiredAuthorizedAdTrackingModules(
  modules: ReturnType<typeof getAdTrackingModules>
): boolean {
  const facebookConfigured = isFacebookTrackingConfigured();
  if (facebookConfigured && !modules.FBSettings) {
    return false;
  }
  if (
    IS_TIKTOK_BUSINESS_CONFIGURED &&
    !modules.TikTokBusiness &&
    !(facebookConfigured && modules.FBSettings)
  ) {
    return false;
  }
  return true;
}
