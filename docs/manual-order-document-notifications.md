# Manual-order document notifications

New manual orders (`recorded_by_user_id` set, no import job/external source) enqueue
one invoice or paid receipt after their item batch is saved. Missing/invalid email,
missing customer/items, cancelled/returned orders and inconsistent paid balances
are not sent. Later full payment queues one receipt, as do late customer-contact
corrections. Existing orders are excluded from automatic notification backfill.

The existing CRON_SECRET-authenticated `/api/cron/order-notifications` worker sends
a branded email with a PDF attachment and a website claim link. Ogabassey also
gets optional app links; other tenants do not get Ogabassey promotion. Claim links
store only the SHA-256 token hash, expire after 90 days and link only the matching
merchant/customer's orders after purchase-email verification. Both legacy and v2
redemption enforce the live `auth.users` email and confirmation state.

Pre-dispatch failures use the existing bounded outbox retry policy. A response
lost after dispatch, accepted send with failed marker persistence or stale
dispatched lease is terminalized as `delivery_outcome_unknown`, not automatically
resent. A provider `client_reference` is an audit correlation, not an idempotency key.

## Local verification

With PostgreSQL tools on PATH, run:

```sh
bash supabase/tests/run-manual-order-document-tests.sh
pnpm --filter @baci/web exec vitest run src/lib/manual-order-document-email.test.ts src/lib/send-manual-order-document.test.ts src/app/api/cron/order-notifications/order-notification-outbox-worker.test.ts
```

The SQL harness creates and destroys its own empty, socket-only PostgreSQL cluster
using synthetic records. It replays the relevant claim/outbox migrations against
a minimal domain fixture; it is not a full Supabase-history replay.

## Activation

Release the matching, backwards-compatible web worker first, then apply both new
append-only migrations to activate the triggers. Drain outbox batches with the
new code only: old workers do not understand the manual document event types. No new email provider,
cron schedule, app release or environment variable is required. Use a disposable
staging merchant and test inbox to verify actual provider acceptance, PDF rendering,
verified sign-in and account receipt access before a production release. No live
mail or production migration is part of local verification.
