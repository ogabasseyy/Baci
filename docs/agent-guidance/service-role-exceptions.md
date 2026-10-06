# Service-role exception renewal: platform analytics

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
