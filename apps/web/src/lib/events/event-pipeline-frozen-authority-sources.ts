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
    'd3f90424593ade0d945da79006044a1132779217e1144dc006056d9060f0715c',
  'apps/web/src/app/api/analytics/ga4/route.ts':
    '9e9b8c3edb1636d2f27e9551568d5036778fce6ab54272f1fd3b77cfd0f88c9f',
  'apps/web/src/app/api/analytics/snapchat/route.ts':
    '39b0f05e22f44f195e3fb52a56d13e4176c01336c5d1c5f4ceab58a9d4c3b563',
  'apps/web/src/app/api/analytics/tiktok/route.ts':
    '6d9d17df68d13a16b3bcd35bb5acfa1a7caac02d73996a656012d18a4146854e',
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
  // authority unchanged. Re-pinned an eighth time: the savings fallback
  // idempotency fingerprint includes the line offer id so two savings
  // orders for different offers of one product mint distinct redemption
  // keys; notification and payment authority are unchanged. Idempotent
  // retries now bypass live offer economics via a keyed-order probe so the
  // RPC replays the stored order; fresh-order validation is unchanged.
  // Re-pinned a ninth time: replay restores the stored discount and
  // canonical per-line fees, and quote validation prices exact-offer
  // lines from live offers; fresh-order authority is unchanged.
  // Re-pinned a tenth time: REDVAULT replay skips stored-discount
  // restore and offer replay falls back to the unambiguous offerless
  // reduced key; notification and payment authority are unchanged.
  // Re-pinned an eleventh time: F1 replay call, failure mapping, and
  // result destructure extracted to resolveOfferReplayForOrderRoute
  // (Boy Scout Rule); replay semantics and responses are unchanged.
  // Re-pinned for the 16..128-byte idempotency-key floor at the route
  // gate (400 for short/low-entropy keys); notification, payment
  // authority, and database operations are unchanged.
  // Re-pinned for reviewed new-order-only attested shipping coordinates.
  // Existing-order replay, notification and payment authority are unchanged.
  // Merge re-pin: branch extraction plus main's attested shipping
  // coordinates; both reviewed, hash covers the union.
  // Re-pinned for the #3651 merge: inline discount economics moved to
  // prepareLoyaltyCheckout (branch F1 replay bypass + offerPrices
  // ported into the helper); notification, payment authority, and
  // database operations are unchanged.
  // Re-pinned for reviewed canonical-cart transaction binding. Existing
  // payment/notification authority is unchanged; no service grants are added.
  // Re-pinned for the shared-cart binding invalid_item status correction
  // (500 -> 400, a client error); payment/notification authority unchanged.
  // Re-pinned for condition-offer validation errors as client errors;
  // payment, notification and credential authority are unchanged.
  // Re-pinned for early cart-proof checks and claimed-voucher binding replay;
  // payment, notification and credential authority remain unchanged.
  // Re-pinned after extracting reviewed cart proof/binding response orchestration;
  // payment, notification and credential authority remain unchanged.
  // Re-pinned for the claimed-voucher replay re-read of the stored order;
  // payment, notification and credential authority remain unchanged.
  // Re-pinned after extracting bound-order dispatch and the shared
  // condition-offer response from the route; payment, notification
  // and credential authority remain unchanged. Re-pinned again after
  // merging the GIGL checkout-pin changes from main; the cart binding
  // dispatch is unchanged. Re-pinned after the orders replay probe moved
  // to the scoped storefront_checkout_replay_snapshot RPC (no service-role
  // client on the route); order authority paths are unchanged. Re-pinned
  // after shared-cart orders were barred from the REDVAULT draft rail.
  // Re-pinned after the replay-snapshot probe moved to the admin client
  // and the RPC was restricted to service_role. Re-pinned again after
  // the probe returned to the normal client with a minimized snapshot
  // projection (no service-role client on the guest checkout path).
  // Merge re-pin for #3693: shared-cart binding/condition-offer response
  // extraction plus this branch offer-economics union; both reviewed,
  // hash covers the union.
  // Re-pinned for the #3687 merge with main: route keeps the branch's
  // prepareCheckoutQuoteDestination extraction (live-offer prices ported
  // into the helper) plus main's loyalty/offer replay behavior, and
  // confirmed airport retries now count as quote replays; notification,
  // payment, tenant authorization, and privileged-client authority are
  // unchanged.
  'apps/web/src/app/api/orders/route.ts':
    '3b336bbab6fb055aa0efd668fa5be82ee517fe553131ba3102403c9d856828e5',
  // Juicyway webhook settlement changed in the merchant-wallet feature. Bind
  // reviewed bytes to a content receipt so inherited-authority checks stay
  // squash-safe after merge.
  'apps/web/src/app/api/payments/juicyway/webhook/route.ts':
    'a8748056acf57c8fe4aea5b5dbf6a2bbcd1599e7aa57af3130cf95c277e61ef5',
} as const;
