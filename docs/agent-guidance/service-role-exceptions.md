# Service-role exception renewals

## Historical contracts

The legacy exceptions recorded in `.ruler/01-critical-rules.md` expired on
2026-09-16. Their historical text is preserved; this document does not renew
those contracts collectively or establish that their runtime edges were retired.

## Platform analytics only

<!-- exception: platform-analytics-bridge status=approved expires=2026-09-30T00:00:00.000Z -->

The repository owner explicitly approved this narrow renewal on 2026-09-27
in the Codex conversation for PR #3523, after being asked to approve only the
platform-events forwarding edge until September 30 or verified worker cutover,
whichever comes first.

The renewal expires at **2026-09-30T00:00:00.000Z**, or verified replacement of
this edge by restricted-worker delivery, whichever occurs first. It authorizes
only this existing server-side call graph:

`apps/web/src/app/api/platform/events/route.ts` →
`apps/web/src/app/api/platform/events/platform-event-forwarding.ts` →
`apps/web/src/lib/supabase/admin.ts#createAdminClient('event-pipeline')`.

The sole privileged database operation is reading `platform_settings` with the
existing exact projection:
`google_analytics_id, ga4_api_secret, facebook_pixel_id, facebook_capi_token`.
Its purpose is preserving existing platform GA4/Facebook event delivery during
the restricted-worker migration. Existing validation, event identity and provider
retry behavior must remain intact.

The backend credential bypasses RLS; these restrictions constrain approved use,
not the key's inherent capability. Credentials must never enter responses, logs,
event payloads or client bundles. No merchant analytics edge, sibling importer,
additional projection, write, RPC or generic service-role operation inherits this
approval. In particular, the `/api/events` and `/api/analytics/conversion` legacy
exceptions remain expired.

This approval does not authorize merging, deployment, production feature-flag
changes or worker activation. A receipt refresh does not renew this exception.
At expiry, remove the privileged edge or obtain a new explicit owner decision;
do not silently extend the date. The durable worker replacement still requires
the validation and rollout gates in [the pipeline runbook](../ops/durable-event-pipeline.md).

## Retirement status

PR #3568 removes the platform route's direct privileged forwarding edge after
its recorded expiry (pending merge and validation). The route continues to persist accepted events through
its existing ingress path. The restricted worker adapter remains available,
but this change does not activate delivery or establish production cutover.

## Merchant cancellation refund push only

<!-- exception: paystack-cancellation-refund-merchant-push status=approved expires=2026-10-28T00:00:00.000Z -->

The repository owner approved a 30-day exception in the Codex conversation for
PR #3522 on 2026-09-28. It expires at **2026-10-28T00:00:00.000Z**. It covers
only the authenticated `cancellationsOnly=true` branch of
`apps/web/src/app/api/cron/process-settlements/route.ts`, its
`process-cancellation-drain.ts` worker, and the
`processed_merchant_push` / `failed_merchant_push` delivery in
`drain-paystack-refund-notifications.ts` through
`apps/web/src/lib/expo-push.ts#notifyMerchant`.

The privileged client in that existing push helper may read active admin-app
`push_tokens` for the queue row's merchant, record the associated
`push_notification_tickets` and `push_notification_attempts`, and deactivate
provider-rejected tokens under its existing error rules. The worker must derive
merchant and order identity from its claimed database row, preserve the cron
secret check, and use the payment notification channel. It must not accept a
merchant ID from a request body or expose tokens or credentials in a response.
No sibling notification, storefront push, generic admin-client query, or
other cron path inherits this exception.

This approval does not authorize merging, deployment, or a broader renewal.
At expiry, replace the privileged delivery edge or obtain a new explicit owner
decision with exact scope and expiry recorded here.
