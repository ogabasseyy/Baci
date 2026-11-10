# Scoped cart notifications worker

Prepared configuration only; no service has been installed or enabled.

**Superseded for delivery (2026-11-10).** Cart change notices are now sent by
the database: a trigger sends at write time and a pg_cron sweep retries
(`supabase/migrations/20261110130000_commerce_cart_publish_on_write.sql`, see
`docs/deploy/shared-cart-rollout.md`). Do not install this service to deliver
notices; running it alongside the sweep is harmless (row locks fence them) but
adds nothing. The notes below remain as the record of the worker design.

**Retention.** This worker was also the only caller of the
`cleanup_commerce_carts` retention pass. Because the worker is not installed,
retention runs instead from the `commerce-cart-retention` pg_cron job (step 5a
of `docs/deploy/shared-cart-rollout.md`), active in production since
2026-11-10.

The tracked `config/baci-cart-events.service` delegates to the existing
`bin/run-web-script.sh` scheduler launcher and the exact `app-live` release.
Its dedicated environment file must be provisioned under separate owner
approval before installation. It needs only the existing public Supabase URL
and anon key, `COMMERCE_CART_WORKER_JWT` for the `commerce_cart_worker` role,
and explicit `COMMERCE_CART_EVENTS_ENABLED=true`. The default is disabled.
Do not supply a service-role key or copy the general workers environment.

The client accepts the JWT until its actual `exp` (no early cutoff) and
re-reads the token file on every pass, so rotation must complete before
`exp` with margin for an in-flight batch; rotation and restart are
operational steps. Never print its claims or value in operator
logs. The database, not the script, verifies signatures and checks the role.

The enabled worker runs `cleanup_commerce_carts` on startup, including
`--once`, and once every five minutes during `--loop`. The RPC uses the same
`commerce_cart_worker` capability and its bounded retention rules for expired
receipts, events, handoffs and checkout sessions, and idle-cart expiration.
A failed cleanup logs a safe error and leaves its next attempt due for the
next loop pass while event publishing continues. A publisher failure still
exits nonzero so the service supervisor can restart it. Cleanup never runs while the existing worker
activation flag is disabled. This change does not install or enable the service.

Because this worker is not installed, that retention pass does not run from
here. The supported way to run it is the pg_cron job in step 5a of
`docs/deploy/shared-cart-rollout.md`, which calls the same
`cleanup_commerce_carts()` function on the same five-minute cadence.
Keep exactly one of the two enabled. If this worker is ever installed with
`COMMERCE_CART_EVENTS_ENABLED=true`, unschedule the `commerce-cart-retention`
pg_cron job first (check `cron.job`); running both is not harmful, because the
function is bounded and idempotent, but it doubles the work and lock traffic.

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
