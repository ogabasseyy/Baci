import { eventPipelineAuthorityCutover } from '../../src/lib/events/event-pipeline-authority-cutover';

export const analyticsDeliveryAuthorityManifest = {
  temporaryAuthorityExpiresAt:
    eventPipelineAuthorityCutover.temporaryAuthorityExpiresAt,
  // The queue-only activation PR must flip this marker. The verifier then
  // revokes the temporary authority immediately, even before the fixed date.
  queueOnlyDeliveryActivated:
    eventPipelineAuthorityCutover.queueOnlyDeliveryActivated,
  authorityClosureHashes: {
    'apps/web/src/app/api/analytics/conversion/route.ts':
      '5a279c699150383ee5b020e0947722da5169ace9a85c63a9e8142580273a9175',
    'apps/web/src/app/api/events/route.ts':
      'c5204ded0eedf71b02fc11983bb8a2c8734cc3a52543f99de21a8b46671fc4b2',
    'apps/web/src/lib/analytics/fetch-analytics-platform-config.ts':
      '95cc62af2d374bfed4b9b89b5b745e2dbd4c34ada1f3a25cf0c398e3cb376c1e',
    'apps/web/src/lib/analytics/trusted-server-ad-platform-fanout.ts':
      '2f330fb4efcd9cbcbef7a524f43232572082908e4f73e27d72a8cbb8636380b5',
    'apps/web/src/lib/supabase/service.ts':
      '8be73838ea9affb50372adc500302a442e87604a969f577e93045338ee1f6ff9',
  },
  callerScopedRouteHashes: {
    'apps/web/src/app/api/analytics/ads/route.ts':
      'dc74e421113d3447a816559282bcd0612c49d68d92403cafe5e9cb7001a35e50',
    'apps/web/src/app/api/analytics/facebook-capi/route.ts':
      'd3f90424593ade0d945da79006044a1132779217e1144dc006056d9060f0715c',
    'apps/web/src/app/api/analytics/ga4/route.ts':
      '9e9b8c3edb1636d2f27e9551568d5036778fce6ab54272f1fd3b77cfd0f88c9f',
    'apps/web/src/app/api/analytics/snapchat/route.ts':
      '9c6c1db9696259aef5526a6913610377fd4d9b27c4bdd99d8516240a2b3a0b1c',
    'apps/web/src/app/api/analytics/tiktok/route.ts':
      '6d9d17df68d13a16b3bcd35bb5acfa1a7caac02d73996a656012d18a4146854e',
  },
  credentialProjections: {
    merchantEntitlement: 'plan_tier, plan_expires_at, premium_features',
    merchantProviderConfig:
      'offline_conversions_enabled, facebook_pixel_id, facebook_capi_token, tiktok_pixel_id, tiktok_access_token, google_analytics_id, ga4_api_secret, snapchat_pixel_id, snapchat_capi_token',
    merchantFeatureProviderConfig:
      'facebook_pixel_id, facebook_capi_token, tiktok_pixel_id, tiktok_access_token, google_analytics_id, ga4_api_secret, snapchat_pixel_id, snapchat_capi_token',
    platformProviderConfig:
      'google_analytics_id, ga4_api_secret, facebook_pixel_id, facebook_capi_token',
  },
  retiredPlatformAuthority: {
    helper: 'apps/web/src/app/api/platform/events/platform-event-forwarding.ts',
    route: 'apps/web/src/app/api/platform/events/route.ts',
  },
  platformRouteHash: {
    path: 'apps/web/src/app/api/platform/events/route.ts',
    sha256: '0e62bed087fd29cb290af99f39dbc8589f9739ff06adde55598045945df7b7b1',
  },
  pureFanoutRoots: [
    'apps/web/src/lib/analytics/send-configured-ad-platforms.ts',
    'apps/web/src/lib/analytics/send-facebook-ad-platform-event.ts',
    'apps/web/src/lib/analytics/send-tiktok-ad-platform-event.ts',
    'apps/web/src/lib/analytics/send-snapchat-ad-platform-event.ts',
  ],
  trustedWrapper:
    'apps/web/src/lib/analytics/trusted-server-ad-platform-fanout.ts',
  trustedWrapperImporters: [
    'apps/web/src/app/api/analytics/conversion/route.ts',
    'apps/web/src/app/api/events/route.ts',
  ],
  verifiedContextHelperHashes: {
    'apps/web/src/app/api/analytics/conversion/conversion-route-merchant-context.ts':
      'fd3686f696b06eb137804956af72c35c11e4578e4580c5e992364d4bda143cef',
    'apps/web/src/app/api/events/resolve-legacy-fanout-context.ts':
      '84abded5972fbab0b42db7e5e4321ea67d89b2ebced97b9d6b46d787bfd84967',
    'apps/web/src/lib/events/event-ingress-context.ts':
      'f47e6d124467b7464fbb267c3874f9f5a35ab74b2cad5e3115da67b8df5211ea',
  },
  workerRoots: [
    'apps/web/src/scripts/process-domain-events.ts',
    'apps/web/src/scripts/process-event-deliveries.ts',
  ],
} as const;
