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

## Corrections and resend

At most one invoice and one receipt row exist per order, and a claim token never
rotates after its send marker is set. A correction that re-triggers the queue
automatically re-arms a skipped or failed row that never started dispatch, so
the corrected document sends without staff action; sent rows and rows that may
already have dispatched (`delivery_outcome_unknown`, dispatch started) stay
terminal to preserve at-most-once delivery. Resending after a successful send
is therefore deliberate:

1. Correct the order contact (`customer_email`/`customer_id`) on the order row.
2. Delete the sent `order_notification_outbox` row; the claim, its order links,
   and the dead claim URL cascade with it.
3. Touch a monitored column (`payment_status`, `amount_paid`, `total`,
   `customer_email`, `customer_id`, `recorded_by_user_id`, `import_job_id`,
   `external_source`, or `shipping_status`) so the update trigger re-evaluates
   and queues a fresh row with a new claim token for the corrected address.

Total corrections alone also re-evaluate eligibility; a paid order whose total
now exceeds its payments additionally needs a consistent `payment_status`
(which itself re-triggers) before the matching document queues. Redemption of
a manual claim requires verified sign-in as the recipient the document was
sent to; unlike import claims it does not require the `customers` row to
agree, because the document already arrived as an email attachment.

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

Release the matching, backwards-compatible web worker strictly first, then
apply the new append-only migrations to activate the triggers, with no
mixed-version consumers draining the queue. Old revisions 500 the whole
claimed batch (including unrelated shipped/delivered rows, which then wait
for lease expiry) when a batch contains a manual event type, so migration
before worker head-of-line-blocks shipping notifications. Drain outbox
batches with the new code only: old workers do not understand the manual
document event types. Watch the cron 5xx rate and outbox lock age while the
new worker rolls out; any `manual_order_*` 500 means an old revision is still
draining, so hold further deploys until the batches clear. No new email provider,
cron schedule, app release or environment variable is required. Use a disposable
staging merchant and test inbox to verify actual provider acceptance, PDF rendering,
verified sign-in and account receipt access before a production release. No live
mail or production migration is part of local verification.
