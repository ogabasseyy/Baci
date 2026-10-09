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
    '0e62bed087fd29cb290af99f39dbc8589f9739ff06adde55598045945df7b7b1',
  // Orders is an inherited event-pipeline entrypoint whose notification
  // dispatch changed in this feature. Keep its reviewed bytes squash-safe by
  // binding the final source to a content receipt instead of a PR-only commit.
  // Refreshed for malformed-JSON rejection before business data access; the
  // inherited notification/payment authority and database operations are unchanged.
  // Re-pinned after merging main (#3525/#3504): keeps this branch's checkout
  // blog-purge scheduling plus main's tracking-link, redvault, and
  // plan-tier-authoritative entitlement additions.
  // Re-pinned for the origin/main merge combining this branch's REDVAULT
  // pilot validation gate with main's live related-product pricing (#3419).
  // Re-pinned for derived pilot tax totals: the route now passes
  // server-computed tax kobo into the pilot validator; notification and
  // payment authority are unchanged.
  // Re-pinned after extracting the pilot order gate into
  // redvault-live-pilot-order-gate.ts; the route is now a thin call
  // site and inherited authority is unchanged.
  // Re-pinned after moving the pilot gate below server-verified fee
  // computation; it now judges the effective shipping fee.
  // Re-pinned for exact condition-offer identity: the route accepts
  // offerId/offer_id twins, passes them into the order RPC items, and
  // verifies each line against live offers (400/500); notification and
  // payment authority are unchanged. Re-pinned again for the offer
  // economics errors: invalid_offer/insufficient_offer_stock map to 400
  // beside the variant twins; no other route behavior changed. Re-pinned a
  // third time for live-offer pricing: the route loads live offer prices
  // once, recomputes offer-line assurance fees from them, and threads them
  // into the negotiation catalog and VAT basis; authority unchanged.
  // Re-pinned a fourth time: fee recompute moved after the negotiation
  // preflight onto the validated charged basis; authority unchanged.
  // Re-pinned a fifth time: offer lines bind the live offer condition
  // (persist it, reject mismatches) and the canonical subtotal prices
  // offer lines from verified live offer economics for discount and
  // shipping-rate eligibility; notification and payment authority are
  // unchanged. Re-pinned a sixth time: offer verification, condition
  // reconciliation, and assurance recomputation move to focused route
  // helpers with identical responses; authority unchanged. Re-pinned a
  // seventh time: those helpers move to lib/checkout (import-only);
  // authority unchanged.
  'apps/web/src/app/api/orders/route.ts':
    '467b5777e5b3bced2c38dfcbf61c109a7ebad7489d7c6e54cb7a9afcd641fb49',
  // Juicyway webhook settlement changed in the merchant-wallet feature. Bind
  // reviewed bytes to a content receipt so inherited-authority checks stay
  // squash-safe after merge.
  'apps/web/src/app/api/payments/juicyway/webhook/route.ts':
    'a8748056acf57c8fe4aea5b5dbf6a2bbcd1599e7aa57af3130cf95c277e61ef5',
} as const;
