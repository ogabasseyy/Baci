# Cache invalidation worker capability

The cache drain remains hosted in the Next.js cron route because ordered
invalidation calls Next's Data Cache APIs before Vercel and Cloudflare purges.
The VPS scheduler continues to make the existing HTTPS request with
`CRON_SECRET`; it does not receive a Supabase worker token or database access.

The route's database authority is moving from the broad service-role key to a
signed `cache_invalidation_worker` PostgREST capability. The role is `NOLOGIN`,
`NOINHERIT`, and `NOBYPASSRLS`; its only database grants are the three cache
outbox RPCs: claim, finish, and dead-letter presence. The app client additionally
allows only those RPC names and pins production requests to the configured
Supabase host.

## Activation gate

The append-only migrations intentionally do **not** grant
`cache_invalidation_worker` membership to `authenticator`. Apply the capability
and request-scope migrations, then require an uninterrupted sample window where
the public PostgREST endpoint denies the new
`__cache_invalidation_hook_reload_canary__` through the shared pre-request
hook. The endpoint exposes no replica identity, so this sample does not prove
per-replica coverage. Only after that sample gate may a separately reviewed,
gated activation grant role membership. Do not combine the grant with either
migration or issue the worker JWT before the hook is observed; PostgREST config
reload is asynchronous.

After the database gate is complete, provision a short-lived JWT with the exact
`cache_invalidation_worker` role claim as
`CACHE_INVALIDATION_WORKER_TOKEN` in the web deployment. Keep the signing
material off the VPS. Until the token and membership are provisioned, the route
fails closed with a generic 500 and the scheduler retries on its existing
cadence. No production capability, role membership, token, or schedule was
changed by adding this source path.

The membership activation is a separate owner-controlled database action.
After staging both migrations and reviewing the live preconditions, run
`.github/scripts/cache-invalidation-worker-activation.sh activate` from the
owner-controlled release context. It performs a read-only, uninterrupted
canary sampling window before granting membership, then verifies the active
token and scope; it automatically revokes a newly granted membership if the
post-grant probe fails. The sampling window can observe stale replicas behind
the public load balancer, but does not guarantee per-replica coverage. It does
not run as part of ordinary deployment automation.
The fixed SQL action is:

```sql
GRANT cache_invalidation_worker TO authenticator;
```

Run it only after the sampled hook probe passes. The release capability
probe must then pass before deploying the web route; it confirms that the
worker token can call the allowed boolean RPC and that the same capability is
denied on an out-of-scope table endpoint.
