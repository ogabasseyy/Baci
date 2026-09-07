export const frozenEventPipelineAuthoritySources = {
  'apps/web/src/app/(platform)/onboarding/actions.ts':
    'ad902de74546a2ab71e1847b25076a3a3d6df711d0d5ea6229796bfe9bbb94d5',
  'apps/web/src/lib/agentic/jwt-signing-material.ts':
    '80d2271351155737a6f247671f8e0b428d7b20285df3db203235c49288c04d92',
} as const;

export const eventPipelineFrozenRoutes = {
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
  'apps/web/src/app/api/platform/events/route.ts':
    'bb3b5ea163f7029bd8a90523ac7944c9e126b2aebc0ce673f82c4e0c48d00161',
  // Orders is an inherited event-pipeline entrypoint whose notification
  // dispatch changed in this feature. Keep its reviewed bytes squash-safe by
  // binding the final source to a content receipt instead of a PR-only commit.
  'apps/web/src/app/api/orders/route.ts':
    '5b605dd9d0d34a040400c5d61d8c81401c6b0a8026513f34835b01ceafc13672',
  // Juicyway webhook settlement changed in the merchant-wallet feature. Bind
  // reviewed bytes to a content receipt so inherited-authority checks stay
  // squash-safe after merge.
  'apps/web/src/app/api/payments/juicyway/webhook/route.ts':
    'a8748056acf57c8fe4aea5b5dbf6a2bbcd1599e7aa57af3130cf95c277e61ef5',
} as const;
