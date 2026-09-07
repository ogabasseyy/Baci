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
      '8747272f15477bffc36d4bd8b18fa046338f1dbc6e1234bcd2400e11694057e2',
    'apps/web/src/app/api/events/route.ts':
      '3e758b45f0809b919f1a058251bb1acd85e6df6de93df2b63f45f6766be67aab',
    'apps/web/src/app/api/platform/events/platform-event-forwarding.ts':
      '78fd66f814bdff4621771fad58965bb9fad5e70d6da1012fa0450faf305bacf6',
    'apps/web/src/lib/analytics/fetch-analytics-platform-config.ts':
      '95cc62af2d374bfed4b9b89b5b745e2dbd4c34ada1f3a25cf0c398e3cb376c1e',
    'apps/web/src/lib/analytics/trusted-server-ad-platform-fanout.ts':
      '2f330fb4efcd9cbcbef7a524f43232572082908e4f73e27d72a8cbb8636380b5',
    'apps/web/src/lib/supabase/service.ts':
      '6754dc6f3381be4653abc91e32e65c741172563db570b81c4e820190384f0e05',
  },
  callerScopedRouteHashes: {
    'apps/web/src/app/api/analytics/ads/route.ts':
      'dc74e421113d3447a816559282bcd0612c49d68d92403cafe5e9cb7001a35e50',
    'apps/web/src/app/api/analytics/facebook-capi/route.ts':
      'f41e1de587645b8fdb2af8af180eb581b2bfeecae688670d7b5c7a80088b7c32',
    'apps/web/src/app/api/analytics/ga4/route.ts':
      '9e9b8c3edb1636d2f27e9551568d5036778fce6ab54272f1fd3b77cfd0f88c9f',
    'apps/web/src/app/api/analytics/snapchat/route.ts':
      '1a7898d59038b6a37e057e74da3907f4a42da9c25c7236e9d324d7b1516e4cd3',
    'apps/web/src/app/api/analytics/tiktok/route.ts':
      '4d59510f6a72ae25dd45c8cc8ea6762a709bf745286140a7a9e1aa4b64ee942e',
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
  platformAuthority: {
    helper: 'apps/web/src/app/api/platform/events/platform-event-forwarding.ts',
    route: 'apps/web/src/app/api/platform/events/route.ts',
  },
  platformRouteHash: {
    path: 'apps/web/src/app/api/platform/events/route.ts',
    sha256: 'bb3b5ea163f7029bd8a90523ac7944c9e126b2aebc0ce673f82c4e0c48d00161',
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
