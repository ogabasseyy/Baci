# Scoped cart notifications worker

Prepared configuration only; no service has been installed or enabled.

The tracked `config/baci-cart-events.service` delegates to the existing
`bin/run-web-script.sh` scheduler launcher and the exact `app-live` release.
Its dedicated environment file must be provisioned under separate owner
approval before installation. It needs only the existing public Supabase URL
and anon key, `COMMERCE_CART_WORKER_JWT` for the `commerce_cart_worker` role,
and explicit `COMMERCE_CART_EVENTS_ENABLED=true`. The default is disabled.
Do not supply a service-role key or copy the general workers environment.

The JWT must have more than five minutes remaining at startup; rotation and
restart are operational steps. Never print its claims or value in operator
logs. The database, not the script, verifies signatures and checks the role.

The enabled worker runs `cleanup_commerce_carts` on startup, including
`--once`, and once every five minutes during `--loop`. The RPC uses the same
`commerce_cart_worker` capability and its bounded retention rules for expired
receipts, events, handoffs and checkout sessions, and idle-cart expiration.
A failed cleanup logs a safe error and leaves its next attempt due for the
next loop pass while event publishing continues. A publisher failure still
exits nonzero so the service supervisor can restart it. Cleanup never runs while the existing worker
activation flag is disabled. This change does not install or enable the service.

Each publisher batch and due cleanup constructs a fresh scoped client. Use
`COMMERCE_CART_WORKER_JWT_FILE` to let the existing token rotator replace a token
file between calls without a worker restart. The inline JWT option requires
process environment refresh and restart when rotated.

The enabled loop drains at most 50 rows per second. PostgreSQL row locks and
`SKIP LOCKED` fence overlapping instances. Sending through `realtime.send`
and acknowledging the outbox share a transaction; disconnect/rollback leaves
the row retryable. The publisher verifies the exact safe message was stored
before acknowledging, because a missing Realtime daily partition can produce
a warning without an exception. Missing sends back off up to 300 seconds and
park after 10 attempts. Logs contain sent/failed/dead-letter counts only.

Enable only after scoped-role WebSocket qualification and the full acceptance
matrix. Both merchant flags `shared_cart` and `shared_cart_realtime` must be
explicitly present. Disable realtime enrollment first during rollback; retain
the compatible canonical cart service and HTTP/focus polling. Never restore a
stale local cart or delete canonical tables as rollback.
