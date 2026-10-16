# Shared server cart: rollout and operational recovery

Status: prepared only. Nothing in this document has been executed
against production. Migrations are registered as pending, feature
flags remain disabled by default, and no merchant is enrolled.

## Controls that already exist

- Merchant-scoped enrollment flags (`shared_cart`, `shared_cart_realtime`,
  `shared_cart_accounts`) via `merchantHasFeature`; explicit grant only,
  disabled for all plans by default. `shared_cart_native` is not a
  `merchantHasFeature` gate: it is a raw `premium_features` value checked
  only by the native enrollment module
  (`apps/mobile-storefront/lib/cart/enrollment.ts`), so enrolling a
  merchant for the pilot must set and verify it there, not through the
  web gate helpers.
- Bounded retention: `cleanup_commerce_carts()` (final body in
  `20261015163000`, batching every statement to 1000 rows per call)
  deletes expired operations/creation requests/events, handoffs
  expired over a day, non-submitted checkout sessions expired over a
  day, and submitted checkout sessions older than 90 days; it flips
  active expired carts to `expired` only when no active, unexpired
  checkout session exists for them (`NOT EXISTS` guard). Unexpired
  retry receipts are spared.
- Transactional outbox publisher with leases, bounded backoff and
  dead-letter handling (local unit/SQL evidence; live qualification
  pending).
- Device-scoped revocation (`commerce_cart_revoke_device_grants`) used
  by native retirement and web sign-out; it never clears cart contents.
- Worker credential boundary: `20261015157000` revokes the
  `commerce_cart_worker` role's direct `SELECT`/`UPDATE` on
  `commerce_cart_events` and drops its policies; the publisher reaches
  the outbox only through the `commerce_cart_publish_events` RPC, and
  retention runs through the SECURITY DEFINER cleanup as the scheduler
  owner. That credential must stay worker-only — never provision it to
  web, native, or any shopper-facing surface.
- Client identity for unauthenticated cart quotas: production runs on
  Vercel, where the edge sets `x-real-ip` (and `NextRequest.ip`), so
  `getTrustedClientIdentifier` buckets preview/create quotas per client.
  Any future non-Vercel or self-hosted deployment must front the app
  with a proxy that overwrites `x-real-ip` with the connection address;
  without one, callers deliberately collapse into the single shared
  `unknown` bucket (fail-closed) rather than trusting a spoofable
  `x-forwarded-for`.
- Terminal-cart retention: the purge function deletes terminal carts
  (completed, expired, canceled) older than 90 days in 500-row batches;
  the 90-day window is the explicit retention decision for this
  feature. Migration application alone does NOT start it:
  `20261015162000` unschedules the hourly pg_cron job
  (`commerce-cart-terminal-purge`) that an earlier migration created,
  so the destructive purge only runs after the activation step below
  schedules it explicitly.
- Worker token rotation: point `COMMERCE_CART_WORKER_JWT_FILE` at a
  rotator-managed file instead of setting `COMMERCE_CART_WORKER_JWT`
  directly; the worker re-reads the file on every batch, so a rotated
  token takes effect within one loop iteration without a restart.
  The client accepts a token until its actual `exp` (no early cutoff,
  so a near-expiry token can finish a batch); rotation must therefore
  complete before that instant, with margin for an in-flight batch.

## Release sequence (requires separate authorization)

1. Review and commit this worktree; regenerate frozen inventories and
   obtain the required review at the exact SHA.
2. Apply pending cart migrations additively; provision cart roles and
   signing material through the approved environment process (no `.env`
   edits are part of this change set).
3. Deploy compatible server adapters with enrollment still disabled.
4. Activate terminal-cart retention explicitly (only with the release
   authorization): where pg_cron exists, run
   `SELECT cron.schedule('commerce-cart-terminal-purge', '37 * * * *', $cron$SELECT public.commerce_cart_purge_terminal_carts(interval '90 days', 500)$cron$);`
   Migration application alone never schedules this job.
5. Pilot one controlled merchant (Ogabassey), run the acceptance matrix
   in `docs/qa/shared-cart-acceptance.md`, then a second merchant.
6. Expand only after convergence, checkout-binding and isolation
   evidence pass at the deployed revision.

## Signing keys

Session proofs and handoff tokens derive separate signing keys from
the provisioned cart master secret (the handoff key is an
HMAC-labelled derivation, `baci-cart-handoff-signing:v1`), so the two
credential types never share a signing key. Rotating the master
secret still rotates both together: outstanding handoff links and
session proofs minted before a rotation stop verifying, so rotate
only with enrollment drained or accept re-issuing live handoff links.

## Rollback

- Disable new enrollment/realtime first. Migrated carts keep canonical
  ownership; never restore stale local carts as authoritative and never
  drop the canonical tables as a rollback step.
- Keep the last compatible server version available while clients
  drain. Native/web clients retain foreground HTTP recovery when
  realtime is disabled.

## Telemetry redaction

The handoff preview endpoint (`GET /api/storefront/cart/handoff`)
takes the pairing secret in the `x-handoff-token` header. Proxy, APM,
and error-reporting pipelines in front of the cart routes must redact
that header exactly like `Authorization` before activation; in-repo
logging never records request headers for these routes.

## Observability gaps to close before activation

- No production dashboards/alerts exist yet for mutation latency,
  version conflicts, replay rate, rejected access, handoff completion,
  realtime join/reconnect lag, or checkout version mismatches. Add
  nonsecret metrics (no cart credentials or customer data in labels)
  during the authorized release, and qualify the outbox publisher
  against the real worker scheduler.
- Quota degradation is an explicit pre-activation gate: when the
  Redis quota store is degraded, anonymous/enumeration operations
  and the server-to-server legacy bridge fail closed, but
  authenticated shopper operations (commands, snapshot,
  checkout_prepare) deliberately fall back to per-instance in-memory
  counters, so one valid proof's effective budget multiplies by the
  instance count for the outage duration. Before any merchant is
  enrolled, put an operator alert on the throttled
  `Cart quota store degraded` warning and confirm the multi-instance
  multiplication is accepted for the pilot, or keep enrollment closed
  until the store is highly available.
