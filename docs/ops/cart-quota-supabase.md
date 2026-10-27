# Cart quota backend recovery

The cart bootstrap endpoint returned HTTP 429 `quota_exceeded` while its shared
Redis counter was unavailable. Production deliberately refuses bootstrap and
creation when only per-instance counters are available. The mobile client
displayed this failure as `temporarily_unavailable`.

The existing Supabase project can provide the atomic counter without a new
provider subscription. This consumes existing database requests, storage and
compute capacity; it is not an unlimited free service. Redis remains the default
until the production configuration explicitly selects Supabase.

## Capability boundary

`CART_QUOTA_BACKEND=supabase` selects the database counter for all cart quotas.
Only `redis` and `supabase` are accepted. A database failure does not switch to
Redis, which could create a second independent allowance for the same caller.
Existing limits and fail-closed operations are unchanged.

The server signs a 60-second JWT using the existing scoped Supabase signer. Its
`commerce_cart_quota` role has no login or RLS bypass and can operate only on the
signed SHA-256 counter key and window. It cannot access carts, customer data or
maintenance. No service-role client is used. Private counter rows contain a hash,
window, count and expiry. The RPC increments atomically and uses database time.
Signing and client construction stay in the existing scoped-cart factory; the
credential-path registry records four exact quota helper paths. Sibling callers
and service-role factories remain rejected by the boundary tests.
The existing PostgREST request guard additionally confines this role to POST on
the single counter RPC. Its other worker branches and reload canaries are
preserved. Future replacements of that guard must preserve the quota branch.

The counter request times out after 1.5 seconds. Existing outage handling applies
if signing, RPC execution or response validation fails. Runtime warnings contain
no tokens, keys, subjects or provider response bodies.

The cron job `commerce-cart-quota-expiry` runs every ten minutes, deleting at most
10,000 rows that expired more than one hour ago. Verify the job exists and is
active before selecting this backend. Monitor counter row growth and database
latency; stale rows do not prevent an expired window from restarting.

## Release order

1. Review the server-only change and pass the repository's required checks.
2. Apply the append-only migration through the normal production migration
   mechanism. Verify its recorded identity, role grants, RLS and active cron job.
3. Verify a signed synthetic counter through the real Data API: two increments
   must return counts one and two with the same expiry. Ordinary anonymous and
   authenticated roles must not execute the RPC. A quota JWT must receive a
   scope denial on an unrelated RPC and on a GET to the counter RPC.
4. Set the nonsecret production variable `CART_QUOTA_BACKEND=supabase` and publish
   reviewed code through the approved VPS prebuilt release flow. Confirm the
   serving alias resolves to that exact commit.
5. Verify bootstrap, cart mutation and checkout review with a disposable guest
   cart. Do not submit an order or payment. Restore the guest cart afterward.
6. Check production quota warnings, RPC errors and database latency after cutover.

Deployment and production verification are separate from local test results.
Do not mark this recovery complete until the live checks pass.

## Rollback

Changing backend starts independent allowances; perform a deliberate cutover,
never automatic failover. Switch to `redis` and redeploy only after a real Redis
health and atomic-counter probe confirms capacity. Rolling back to the previous
application artifact restores its Redis behavior and may restore this outage.
The migration can remain installed: ordinary client roles cannot use it, and the
cleanup job only touches quota counters. Do not drop cart/customer data or reset
all quotas to make a probe pass.

## Local verification

The regression tests cover healthy operation, exhausted allowances, malformed
responses, timeouts and production fail-closed behavior. The isolated PostgreSQL
test covers restricted grants, RLS scope, expiry, invalid capability rejection
and bounded cleanup. A concurrent probe must return one unique contiguous count
per request, with no lost increments. Local SQL fixtures never use production
customer or cart rows.
