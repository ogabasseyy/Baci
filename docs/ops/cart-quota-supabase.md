# Supabase cart quota release

The commerce cart and MCP guest cart already persist in Supabase. This change
selects Supabase for cart quota counters so a failed Redis service does not
block new cart creation. Other rate limits and provider budgets still use
Redis until their own migrations are complete.

## Runtime behavior

CART_QUOTA_BACKEND defaults to redis when unset or blank. Set it to supabase
only during an authorized release after the database and load gates below.
Unknown values fail closed instead of silently selecting another store.
Changing stores resets live quota windows unless their state is transferred.

The server mints a 60-second JWT for one hashed counter key and window using
the existing scoped signer. The commerce_cart_quota role cannot log in, bypass
RLS, read carts or invoke cleanup. The private counter RPC increments atomically.
The PostgREST pre-request guard confines the role to POST on that RPC. No
service-role client is used for shopper traffic.

The current operation budgets and outage policy remain in request-quota.ts:
anonymous creation and credential operations fail closed, while bootstrap
uses its reduced network-bound memory budget and eligible shopper operations
can use bounded memory. A request shares a provisional 750 ms quota deadline
for availability-first operations or 1,500 ms for shared-store-required
operations. These are engineering defaults, not measured production SLOs;
qualify them under staging load before activation. A timed-out increment may
have committed and is not retried against another durable store.

Warnings include only an allowlisted backend and failure category. They never
contain a quota key, customer identifier, JWT, signing material or raw provider
error. A quota denial still returns 429; web copy is neutral because the same
status can represent a backend outage. Updated native copy requires a separate
mobile release.

Anonymous quota denials emit `Cart quota denied` with only the operation,
pre-resolution or merchant scope, degradation status, and one of credential,
missing credential, invalid credential, or network backstop. These log events
permit legacy-client and shared-network denial counts without recording the
credential, IP, merchant ID, quota key or proof. Configure and verify the
release's log-based metrics and alerts separately; these events alone do not
establish that alert delivery or the installed mobile credential is working.
Events aggregate repeated denials within each category using an `occurrences`
count and exponential reporting thresholds. Unflushed counts can be lost if an
instance stops, so log totals are a lower bound, not an exact denial rate.

## Guarded migration sequence

1. Capture the installed request guard definition/hash, role state and
   migration history. Confirm the quota grant migration is not already
   recorded. A late scope migration deliberately stops rather than revoking
   an already active quota role.
2. Apply through 20261027051250_commerce_cart_quota_guard. It installs the
   quota guard and a reload canary while keeping authenticator membership
   revoked. The version is intentionally one step before the existing,
   un-applied 20261027051251 quota grant migration.
3. Run probe-cart-quota-hook-reload.sh. The production workflow caps the
   applier at the scope migration, requires a unanimous response window, then
   applies remaining migrations. The probe documents the residual uncertainty
   of a sticky load balancer.
4. The existing 20261027051251 migration creates the counter and grants the
   scoped role. The workflow blocks deployment unless the scheduled
   commerce-cart-quota-expiry job is active, correctly configured and has a
   recent successful run. The job runs every ten minutes and purges at most
   10,000 rows expired for over an hour.
5. From an approved server environment containing the existing Supabase URL,
   anon key and scoped signer, run the synthetic HTTP probe before changing
   the flag:

   NODE_OPTIONS=--conditions=react-server pnpm --filter @baci/web exec tsx src/scripts/probe-cart-quota.ts --execute

   It creates only a synthetic hashed quota key, checks counts 1 and 2 with
   the same expiry and proves the guard denies a sibling RPC. It prints no
   credentials or raw provider errors. Because it imports the app's existing
   environment validator, a standalone process also needs its required
   server fields; in particular `SUPABASE_SERVICE_ROLE_KEY` must be nonempty.
   A nonsecret placeholder satisfies that unrelated validation: the probe
   does not use the value for a request or create a service-role client. Do not modify
   the deployed environment to run the probe. SQL-set claims alone do not
   prove JWT verification. If this probe cannot run safely before activation,
   record the gap and make the first controlled test-cart request the positive
   HTTP checkpoint, stopping immediately on failure.
6. Verify existing GIGL, blog-media, MCP and ordinary anon/authenticated paths
   using read-only calls or designated synthetic fixtures. Review a forward
   recovery migration before release: recheck the guard hash, revoke the
   quota role from authenticator, then restore the captured guard.

## Release and verification

Measure production traffic and staging p95/p99 latency, same-key contention,
unique-key churn, PostgREST pool usage and database headroom. Set explicit
stop thresholds and obtain acceptance of the one-hour counter reset. Confirm
which MCP bridge and mobile credential versions are actually live. Current
PR review and CI must match the release SHA.

Apply migrations, complete the guard and cleanup checks, then set the
nonsecret backend flag and use the repository-approved VPS prebuilt release.
Test designated carts with both credential and legacy clients. If the MCP
bridge is enabled, test its initial guest-cart creation, mutation and handoff.
Do not submit an order or payment. Monitor quota degradation, legacy-network
denials, cart and checkout latency, database capacity and cleanup for a full
quota window.

A Redis flag rollback cannot restore cart creation while Redis is degraded.
Keep anonymous creation fail-closed, repair the Supabase path and release a
reviewed forward fix. Any emergency return to a writable Redis service needs
a separate decision and counter-continuity check.

## Forward recovery for the request guard

Prepare a new timestamped migration only if recovery is needed; do not add a
placeholder migration to the automatic deployment stream. Before the scope
migration, capture the complete `pg_get_functiondef` and its `md5` for
`public.enforce_gigl_tracking_worker_request_scope()`. After each scope/grant
step, separately capture the installed definition and hash. Preserve these
receipts without credentials.

The reviewed recovery migration must execute in one transaction and:

1. Assert that the current function's hash matches the captured post-change
   hash. Stop without changing membership or the function if it differs.
2. Revoke `commerce_cart_quota` membership from `authenticator`.
3. Restore the exact captured pre-change function definition, preserving its
   owner and function privileges, and notify PostgREST to reload config and
   schema. Do not reconstruct the old guard from a stale repository file.
4. Verify the restored definition hash and check the role membership is gone.
   Run read-only or synthetic positive and negative checks for the existing
   GIGL, blog-media and MCP worker scopes and for anon/authenticated routes.

Revocation prevents new requests using the quota role; account for requests
already in flight and verify convergence after the notifications. The quota
backend will fail closed until a reviewed forward repair is deployed. The
captured hashes, migration bytes, rollout owner and verification receipts are
release-specific and must be reviewed before applying the recovery migration.

Local SQL and PostgREST tests use synthetic credentials and a disposable
database. They do not establish production migration, deployment, MCP
activation or mobile rollout.
