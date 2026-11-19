# Shared server cart: rollout and operational recovery

Status: prepared only. Nothing in this document has been executed
against production. Migrations are registered as pending, feature
flags remain disabled by default, and no merchant is enrolled.

Authoritative pending-migration count: **83** cart migrations are
registered (at the time of writing; the registry-pinned length in
the cited test is the authority whenever it changes) in
`apps/web/tools/db/expected-cart-pending-sources.test-support.ts`
(asserted by `supabase-history-replay-cart-pending-sources.test.ts`).
Any other count in PR descriptions or earlier notes is superseded by
that registry. Merge requires fresh CI green on the merge head,
including the full Supabase history replay (DB Replay) applying all
83 (the registry-pinned count above) in timestamp order; activation additionally requires the replay
and enrollment gates in the release sequence below.

## Controls that already exist

- Merchant-scoped enrollment flags (`shared_cart`, `shared_cart_realtime`,
  `shared_cart_accounts`) via `merchantHasFeature`; explicit grant only,
  disabled for all plans by default. `shared_cart_native` is not a
  `merchantHasFeature` gate: it is a raw `premium_features` value checked
  only by the native enrollment module
  (`apps/mobile-storefront/lib/cart/enrollment.ts`), so enrolling a
  merchant for the pilot must set and verify it there, not through the
  web gate helpers. For the cart features specifically, every gate
  requires the exact canonical value: the web `merchantHasFeature`
  special-cases `shared_cart`/`shared_cart_accounts`/
  `shared_cart_realtime` to exact string matches, the native
  `hasCartFeature` does the same, and the SQL cart RPCs and realtime
  checks use exact jsonb containment. Enrollment must therefore
  always store the canonical exact-lowercase values (`shared_cart`,
  `shared_cart_realtime`, `shared_cart_accounts`, `shared_cart_native`);
  non-canonical stored values silently keep every cart surface
  disabled. (Trim + lowercase normalization in the web helper applies
  only to non-cart feature gates.)
- Cloudflare visitor trust for anonymous cart quotas
  (`apps/web/src/lib/cloudflare-peer.ts`): `CF-Connecting-IP` is only
  used as a quota identity when the platform-verified peer is inside
  Cloudflare's published egress ranges. Hard deploy prerequisite:
  restrict origin ingress to the proxied Cloudflare zone
  (Authenticated Origin Pulls or equivalent) so callers originating
  from other Cloudflare egress (e.g. a Worker fetching the origin
  directly) cannot present forged `CF-Connecting-IP`/`CF-Ray` headers.
  Until that restriction is verifiably in place, treat this trust as
  quota-shaping only — it is never an authentication signal.
- Bounded retention: `cleanup_commerce_carts()` (final body in
  `20261015163000`, batching every statement to 1000 rows per call)
  deletes expired operations/creation requests/events, handoffs
  expired over a day, non-submitted checkout sessions expired over a
  day, and submitted checkout sessions older than 90 days; it flips
  active expired carts to `expired` only when no active, unexpired
  checkout session exists for them (`NOT EXISTS` guard). Unexpired
  retry receipts are spared.
- Change notices are sent by the database itself
  (`20261110130000_commerce_cart_publish_on_write.sql`): a trigger on the
  outbox sends each notice inside the cart write's transaction, and a
  pg_cron sweep (`commerce-cart-publish-events`, every 30 seconds) retries
  anything that was not confirmed, with leases, bounded backoff and
  dead-letter handling. A failed send never fails a cart write. No worker
  process or worker credential is needed; the VPS worker described in
  `vps-workers/docs/cart-events.md` is not installed. The first live
  switch-on (2026-11-10) found the original publisher could never
  acknowledge a send, because `realtime.send` adds an `id` to the stored
  payload; the sender now supplies its own id and confirms by it.
  `commerce_cart_publish_health()` reports stale and dead-lettered notices
  as counts for alerting. The sweep sends at most 100 notices a minute, so
  when a merchant with an existing undelivered backlog is first enrolled,
  drain it by calling `commerce_cart_publish_events(50, 'operator-backfill')`
  repeatedly from a database-owner connection (the SQL editor or
  `supabase db query --linked`; the function is not callable by API roles) before relying on the alarm; otherwise
  `/api/cron/cart-notice-health` reports the old backlog as stale until the
  sweep catches up. A notice that fails ten sends is dead-lettered and not
  retried; the alarm reports it for 24 hours. Write-time sending adds
  one insert and one indexed lookup to each cart write for an enrolled
  merchant, so compare cart-write latency before and after the first
  enrollment. Kill switch that keeps delivery working through the sweep
  alone (notices then arrive within about 30 seconds):
  `ALTER TABLE public.commerce_cart_events DISABLE TRIGGER commerce_cart_events_send_on_write;`
  (re-enable with `ENABLE TRIGGER`). Removing a merchant's
  `shared_cart_realtime` flag stops both paths for that merchant. The
  health counts are readable with the public anon key by design: an
  accepted, unauthenticated operational signal with no cart, shopper or
  merchant data.
  Sending is only half of delivery. The second live switch-on
  (2026-11-11) found every browser was refused when joining its channel:
  Realtime authorizes a private-channel join with a probe row that never
  sets `private`, and the receiver policies required `private IS TRUE`
  (fixed by `20261111100000`). Notices were sent and acknowledged while
  carts converged only through the 15-second fallback poll, and the send
  health check stayed green. After any change to the receiver policies or
  a Realtime upgrade, verify a real join: with live updates on, a
  storefront tab must poll `/api/storefront/cart` about once a minute, not
  every 15 seconds, and a second tab must update within about a second of
  a cart edit. `supabase/tests/commerce_cart_receive_join_probe.sql`
  replays the join check with a production-shaped probe.
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
  schedules it explicitly. Migrations are append-only, so the earlier
  scheduling migration stays as written; the transient window during
  a first deployment is inert because the cart tables are empty until
  enrollment (which happens only after the full chain, including the
  unschedule, has applied and been verified), and the deployment
  checklist below confirms `cron.job` has no purge job before any
  merchant is enrolled.
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
   edits are part of this change set). Every non-Vercel production
   deployment must also provision one stable, deployment-unique
   `CART_PROOF_ENVIRONMENT` shared by all its instances: proof issuance
   and verification fail closed without it, and distinct deployments
   must never share a value (or the master secret).
3. Before deploying the Cloudflare visitor-quota trust: verify the
   origin is restricted to the proxied Cloudflare zone
   (Authenticated Origin Pulls or equivalent) and confirm a
   direct-to-origin request with forged `CF-Connecting-IP`/`CF-Ray`
   headers is rejected or ignored; record the evidence. This is a
   hard gate for that change, not a follow-up. Also wire an operator
   alert on the `Cart quota store degraded` warning before rollout.
4. Deploy compatible server adapters with enrollment still disabled.
5. Activate terminal-cart retention explicitly (only with the release
   authorization): where pg_cron exists, run
   `SELECT cron.schedule('commerce-cart-terminal-purge', '37 * * * *', $cron$SELECT public.commerce_cart_purge_terminal_carts(interval '90 days', 500)$cron$);`
   Migration application alone never schedules this job.
   Activated in production on 2026-11-10 with the owner's approval.
5a. Activate bounded retention explicitly (only with the owner's
   authorization): where pg_cron exists, run
   `SELECT cron.schedule('commerce-cart-retention', '*/5 * * * *', $cron$SELECT public.cleanup_commerce_carts()$cron$);`
   `cleanup_commerce_carts()` was written to be run by the cart events
   worker, which was never installed, so until this job exists nothing
   deletes expired retry receipts, account-operation receipts, creation
   requests and outbox events,
   handoffs expired over a day, non-submitted checkout sessions expired
   over a day, or submitted checkout sessions older than 90 days, and
   nothing flips idle carts to `expired`. Each call handles at most 1,000 rows per
   table, so a backlog drains over successive runs. Flipping an idle cart
   to `expired` should not take anything away from a shopper: a
   cart and its guest grant are both created with a seven-day life
   (`20261012050200_commerce_cart_commands.sql`), and cart access requires
   an unrevoked, unexpired grant. Grants issued later (pairing, account
   link) can outlive the cart, so confirm before activating that no
   active cart past `expires_at` still has a live grant, by running
   `SELECT count(*) AS expired_active, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.commerce_cart_grants g WHERE g.cart_id = c.id AND g.revoked_at IS NULL AND g.expires_at > now())) AS with_live_grant FROM public.commerce_carts c WHERE c.state = 'active' AND c.expires_at < now();`
   and requiring `with_live_grant = 0`. The result is time-sensitive:
   always run it at activation and record the output with the activation
   evidence. (Dated example only, not current state: on 2026-11-10 it
   returned `expired_active = 528, with_live_grant = 0`.) `expired_active` is an upper bound on the
   carts that will flip: the function also skips carts with a live
   checkout session or a live dispatch hold, so fewer flips than that
   count is expected, not a fault. Activated in production on 2026-11-10
   with the owner's approval: the pre-check at 13:03 UTC returned
   `expired_active = 528, with_live_grant = 0` and no existing job; the
   first run flipped all 528 carts, and the first scheduled run (13:05
   UTC) succeeded. It does
   start the 90-day clock after which the terminal purge deletes the cart.
   Dispatch-held carts, handoffs and checkout sessions are skipped by the
   function's own fences. Schedule it as the role that owns the
   SECURITY DEFINER function, because definer rights follow the function
   owner: confirm it with
   `SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'public.cleanup_commerce_carts()'::regprocedure;`
   (`postgres` in production, the same role that owns the terminal-purge
   job). No migration sets that owner explicitly, so it is whichever role
   applied the chain. This step applies only where pg_cron is installed
   (`SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron'`
   returns a row); without it there is nothing to schedule. Verify
   afterwards with
   `SELECT jobname, schedule, username, active FROM cron.job WHERE jobname = 'commerce-cart-retention';`
   (expect one active row whose `username` is the function owner). Before
   activation the same query must return no row. To stop it:
   `SELECT cron.unschedule('commerce-cart-retention');`
   Migration application alone never schedules this job.
6. Pilot one controlled merchant (Ogabassey), run the acceptance matrix
   in `docs/qa/shared-cart-acceptance.md`, then a second merchant.
7. Expand only after convergence, checkout-binding and isolation
   evidence pass at the deployed revision.

## Signing keys

Session proofs and handoff tokens derive separate signing keys from
the provisioned cart master secret (the handoff key is an
HMAC-labelled derivation, `baci-cart-handoff-signing:v1`), so the two
credential types never share a signing key. Rotating the master
secret still rotates both together: outstanding handoff links and
session proofs minted before a rotation stop verifying, so rotate
only with enrollment drained or accept re-issuing live handoff links.

Compromise recovery is stricter than routine rotation: retired
secrets stay acceptable for a bounded 24-hour grace based on the
proof's issued-at claim, so a compromised retired secret can mint
backdated proofs until that window closes. Rotation alone is
therefore never compromise recovery. Immediately remove the compromised
key from `CART_SESSION_PREVIOUS_SECRETS` on every verifier and rotate
the current key if it is affected. Do not keep a compromised key for
availability grace. This is an authorized operational change, not
something this PR provisions. Revoke all affected live cart grants
(forcing shoppers through a fresh bootstrap), including grants whose
key provenance cannot be established: removing the HMAC key alone does
not revoke already minted scoped database JWTs, which can live for up
to five minutes. Record verifier convergence and grant revocation before
calling recovery complete. A `kid` selects a key; it cannot prevent a
holder of that key from signing a forged issuance time.

## Deployment checklist (migration chain)

- Never set the `shared_cart` / `shared_cart_accounts` /
  `shared_cart_realtime` premium_features flags before the full
  migration replay has been verified on the target environment:
  `merchantHasFeature` is a pure flag check with no migration probe,
  so flag-first enablement makes cart routes call missing RPCs and
  fail closed (503). The release sequence below is the guard: replay
  and verify first, enroll second.
- Never let `20261015170000` or `20261015168000` be the tip of an
  applied chain: those intermediate migrations grant SECURITY DEFINER
  replay-snapshot / handoff-preview RPCs to anon, and later append-only
  migrations (`20261015176000`, `20261015179985`, `20261015179990`)
  revoke anon and add route-claim / scoped-previewer checks. Apply
  the chain only as a whole, and verify the final state — the SQL
  contracts `supabase/tests/commerce_cart_replay_privileges_feature_shapes.sql`
  and `supabase/tests/commerce_cart_preview_authority.sql` (wired into
  the commerce-cart SQL bridge) assert anon cannot execute them.
- Immediately after `20261015154000` applies and before any later
  migration or enrollment step, inspect `cron.job` for a terminal-cart
  purge job: the chain briefly schedules that purge mid-chain and
  `20261015162000` unschedules it, so a deployment paused or restored
  between the two must not resume enrollment until the final state is
  confirmed unscheduled.
- After the full chain applies, verify no purge job exists in
  `cron.job`, and only then begin merchant enrollment.

## Rollback

- Disable new enrollment/realtime first. Migrated carts keep canonical
  ownership; never restore stale local carts as authoritative and never
  drop the canonical tables as a rollback step.
- Removing `shared_cart`, unpublishing a store, or remapping a slug or
  custom domain to another store reaches the cart read, create and
  command routes within 30 seconds, not instantly: each warm server
  instance reuses a published store's mapping and feature row for that
  long (`CART_MERCHANT_LOOKUP_TTL_MS`). Other cart routes read them on
  every request.
- Keep the last compatible server version available while clients
  drain. Native/web clients retain foreground HTTP recovery when
  realtime is disabled.

## Telemetry redaction

Anonymous cart calls carry the client quota credential in the
`x-baci-client-credential` header. It is a quota identity, not an
authentication secret, but a leaked value lets an attacker burn one
shopper's quota bucket, so treat it like a session identifier: it is
on the same proxy/APM redaction denylist below, and in-repo logging
never records it (quota keys store only its SHA-256 hash).

Abuse posture: credential budgets are always paired with a
non-rotatable network backstop at 25x the primary limit. That
backstop is a deliberate trade-off, not strict isolation — a hostile
host sharing an egress with legitimate shoppers can still exhaust
the shared backstop and deny them until the window resets, exactly
as any finite per-network ceiling allows. The multiple is sized far
above legitimate shared-egress volume; alert on sustained backstop
denials rather than raising it silently. While the Redis quota
store is degraded, the credential dimension is skipped and network
identity alone applies, so the bounded per-instance memory store
cannot be poisoned by credential churn.

Privacy basis: the credential is a persistent random per-profile /
per-install quota key. It exists solely so anonymous budgets follow
the shopper instead of their network address. It is never used for
authentication, advertising, or cross-merchant joins; clients
store a separate credential per merchant and quota keys are
merchant-salted SHA-256 hashes with the budget window as their
retention, and the raw value is redacted from telemetry (below).
Web handoff preview sends no credential (the merchant is learned
from the preview itself) and uses the verified network identity;
mobile handoff preview sends its per-merchant credential (the slug
is known from app config). Either way, stored quota keys are never
joinable across merchants: clients store a separate credential per
merchant wherever the merchant is known, and every quota subject is
a merchant-salted hash. Deleting site/app data rotates it.

Accepted risk — Redis key cardinality: in the healthy-store path,
each distinct credential creates its own quota key per merchant
and operation (bounded per network by the backstop, e.g. 3,000
bootstrap keys/hour/network/merchant, all TTL'd to their budget
window). Alert on Redis key-count/memory growth alongside the
degradation warning; revisit a cardinality guard only if key
pressure is observed.

The handoff preview endpoint (`GET /api/storefront/cart/handoff`)
takes the pairing secret in the `x-handoff-token` header. Proxy, APM,
and error-reporting pipelines in front of the cart routes must redact
that header exactly like `Authorization` before activation; in-repo
logging never records request headers for these routes. This is an
explicit pre-activation checklist item (not a documentation-only
note): before any merchant is enrolled, verify against the deployed
proxy and APM configuration that (1) `x-handoff-token` and
`x-baci-client-credential` are on the header denylist alongside
`Authorization`, and (2) a synthetic handoff preview request and a
synthetic bootstrap request leave no token or credential value in
proxy, APM, or error-reporting captures; record both checks in the
activation evidence. Enrollment stays closed until they pass.

Preview RPC authority: both preview functions require the dedicated
`commerce_cart_previewer` role and a server-signed `cart_handoff_id`
claim matching the requested handoff. The HTTP route mints this
server-only, five-minute authority only after the per-client quota;
it applies the merchant quota before assembling the preview. `anon`,
`authenticated`, and `service_role` cannot execute the preview RPCs.
The role has no direct cart-table access. Apply the registered scoped
preview migration before serving this route; no fallback to anonymous
RPC execution is permitted.

The raw pairing token still reaches PostgreSQL as an RPC argument.
Before enrollment, verify database statement logging and APM do not
persist preview arguments, alongside the `x-handoff-token` header
redaction check above. The scoped role fixes route-quota bypass; it
does not by itself establish safe operational logging.

Accepted surface: on shared platform hosts, a same-host Referer slug
may select which merchant a path-routed storefront hint names
(`resolveCartMerchant`). The Referer is client-supplied and therefore
only a selection signal, never authority: session principals are
rechecked against the resolved merchant (`merchant_mismatch`), proofs
are merchant-bound, and forging the pair gains no cross-tenant cart
access. The residual is that an apex caller can mint anonymous
bootstrap/create carts for an arbitrary merchant — equivalent to
visiting that storefront directly — bounded by per-IP proxy limits
and per-merchant bootstrap/create quotas. This is accepted for the
pilot; revisit if anonymous cart pollution is observed.

Voucher credential storage: committed cart lines persist the quiz
voucher token in cleartext, and authenticated cart snapshots return it
to verified grant holders of that cart, because the orders route's
voucher verification consumes the client-presented token and the
binding flow revalidates the committed pair. The token is
user/product/variant/condition-bound and single-award, and the
unauthenticated surfaces (handoff preview, merge conflicts) redact it;
the accepted exposure is therefore database/backup holders and the
cart's own grant holders, for the cart's lifetime (bounded by the
terminal purge). Treat cart tables and any receipt payloads embedding
snapshots as credential-bearing in backup/log handling; replacing the
stored cleartext with a keyed hash is a recorded follow-up that must
land before any broader (multi-merchant) voucher rollout.

MCP canonical bridge: the bridge targets only origins allowlisted in
`MCP_CANONICAL_CART_BRIDGE_ALLOWED_ORIGINS` (default
`https://ogabassey.com`). A deployment whose configured origin is not
allowlisted serves legacy guest carts only, and that state is
operator-visible as `guestCartsCanonical: 'disabled'` in the MCP
`/health` response (it does not degrade legacy carts). Confirm the
field reads `enabled` for every deployment expected to migrate MCP
guest carts to the canonical shared cart.

Merchant agentic context: `resolve_agentic_merchant_context` is available
only to the server-minted `agentic_merchant_context` role, with a
normalized configured-slug claim matching the requested slug. It has
no direct table grants; anonymous, ordinary authenticated and service
roles cannot execute the projection. This keeps private checkout
controls and agent allow/deny lists out of public PostgREST responses.
Apply the registered authority migration before serving the new UCP
callers; no anonymous fallback or new production secret is introduced.

## Observability gaps to close before activation

- No production dashboards/alerts exist yet for mutation latency,
  version conflicts, replay rate, rejected access, handoff completion,
  realtime join/reconnect lag, or checkout version mismatches. Add
  nonsecret metrics (no cart credentials or customer data in labels)
  during the authorized release, and qualify the outbox publisher
  against the real worker scheduler.
- Quota degradation is an explicit pre-activation gate: when the
  Redis quota store is degraded, anonymous/enumeration operations
  (create, handoff preview/redeem/issue, account link, session
  revoke) and the server-to-server legacy bridge fail closed.
  Bootstrap is the exception — it is a stateless proof mint and
  degrades to a reduced per-instance ceiling
  (`DEGRADED_BOOTSTRAP_LIMIT`) so a Redis outage cannot blank every
  shopper's cart at the first step; proofs minted then still cannot
  materialize carts because create stays fail-closed. Authenticated
  shopper operations (commands, snapshot, checkout_prepare)
  deliberately fall back to per-instance in-memory
  counters, so one valid proof's effective budget multiplies by the
  instance count for the outage duration. Before any merchant is
  enrolled, put an operator alert on the throttled
  `Cart quota store degraded` warning and confirm the multi-instance
  multiplication is accepted for the pilot, or keep enrollment closed
  until the store is highly available. At the bounded fallback capacity
  of 4096 subjects, new subjects are denied until a window expires;
  production operations that already fail closed on Redis degradation
  never allocate fallback counters, so their hour-long denied windows
  cannot crowd out authenticated traffic. Live counters are never
  evicted to admit subject churn. Existing
  subjects retain their budgets. Per-instance budget multiplication
  remains an explicit availability trade-off and activation gate.
