# Production error follow-up (2026-09-27)

## Scope and evidence

- Production remained on PR #3521 / `075eac2171` during inspection.
- The attempted 72-hour Vercel CLI scan was incomplete: older-window requests
  returned HTTP 400; broad 1,000-row responses repeated only 52 request IDs.
  These samples must not be presented as 72-hour totals or error rates.
- A subsequent Vercel runtime-errors API query for `since=72h` returned 28 grouped
  errors. These are provider-reported group counts, not a complete raw-log export
  or traffic-normalized rates. Historical group first-seen timestamps are not
  the query-window start.
- The aggregate included 1,750 repairs errors, 283 completion-HMAC errors,
  220 merchant analytics configuration errors, 117 storefront read timeouts,
  and 41 platform-event RLS errors. A subsequent one-hour query still reported
  storefront timeouts; production is not clean.
- Separate follow-ups include the missing `products.rating` reference (the live
  schema has `average_rating`), out-of-range product-index pagination, shipping
  provider failures, and authentication/payment errors. These require their own
  scoped diagnosis and regression coverage, not an unverified proxy rewrite.
- Observed errors: completion-HMAC provisioning, repairs prerender cancellation,
  Facebook configuration lookup, platform-event RLS rejection, and one Monnify
  discovery-budget exhaustion. No causal attribution to #3521 is established.

## Changes

1. Repairs catalog fetch waits for `connection()` inside the existing Suspense
   boundary. The committed hero stays static and genuine database errors retain
   the empty-catalog fallback.
2. Platform telemetry uses insert-only persistence. PostgreSQL applies SELECT
   policies to `ON CONFLICT (event_type,event_id) DO NOTHING`; anonymous ingress
   intentionally has no SELECT policy. A disposable local PostgreSQL reproduction
   confirmed old upsert fails, plain insert succeeds, duplicate insert returns
   23505, and SELECT remains empty. Only the exact event-identity constraint is
   accepted as a duplicate; existing provider retry behavior is preserved. Production
   policies were inspected read-only and were not changed.
Facebook compatibility ingress is NOT changed in this patch. A local queued-ingress
experiment passed targeted tests but failed the authority verifier: importing the
scoped JWT signer introduces a new credential-authority edge. The experiment was
removed from the shippable diff and preserved separately. Do not loosen the verifier
allowlist without reviewing that authority contract.

## Mandatory release gates: Facebook is NOT ready for standalone deployment

The Vercel project has no `EVENT_PIPELINE_*` settings, and both VPS event services
reported inactive. The queued-ingress experiment would return 503 while enqueue is off.
Do not ship it as a working production analytics repair without completing the
existing [pipeline runbook](durable-event-pipeline.md).

- Verify signing-key availability, migration/RLS integration and worker code parity.
- Validate provider mapping, retry identity, consent, shadow comparison and failure
  recovery in an approved non-production environment.
- Confirm merchant/destination canary controls and legacy duplicate avoidance.
  Do not flip global flags merely to enable this one compatibility endpoint.
- Obtain explicit approval for production flag changes and activation; inspect
  heartbeats, queue age and provider delivery before claiming restoration.
- Complete fresh code review, CI and an authorized VPS prebuilt deployment.

The HMAC secret was separately added to Vercel production with owner approval;
the existing deployment does not yet contain it. No production deploy occurred.

## Not changed

Monnify discovery already has a bounded abort and preserves the other provider's
billers. One degraded 200 response does not justify changing payment-provider
timeouts or suppressing errors. Investigate recurrence separately.

Middleware PR #3521 is merged and live. No additional proxy edit is included.
Outstanding work: CSP issue #3519 (report-only/integration gates before enforcement),
matching-traffic before/after cost measurements, and production regression checks
after this follow-up ships. No percentage or dollar savings are established.
