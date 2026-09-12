# Cache-invalidation queue wake proposal

Status: proposal only (2026-09-02). Polling remains the production contract.

## Decision

Do not replace the two-minute VPS sweep yet. The repository has a durable
`cache_invalidation_outbox` and claim/finish RPCs, but no configured queue,
consumer, provider binding, signed wake endpoint, or end-to-end test that can
prove a wake is delivered. The current worker therefore keeps discovery within
two minutes and remains the loss-recovery path.

`vps-workers/jobs/run-cache-invalidation-cron.mjs` invokes
`/api/cron/drain-cache-invalidations` under the existing `flock` schedule,
using only `BACI_WEB_BASE_URL` and `CRON_SECRET`. It claims immutable targets,
preserves Next → Vercel → Cloudflare ordering, and uses the state file only to
deduplicate dead-letter alerts. A failed wake must never strand an outbox row.

## Provider audit

* **Vercel Queues** (currently Beta) provides durable topics, push or poll
  consumers, at-least-once delivery, visibility leases, retries, and optional
  idempotency keys. Push consumers are private Vercel Functions configured by a
  `queue/v2beta` `vercel.json` trigger; there is no queue resource, topic,
  trigger, or SDK usage in this repository. Vercel has no built-in DLQ, so a
  poison-message policy would be required. See the [Vercel Queues overview](https://vercel.com/docs/queues)
  and [API reference](https://vercel.com/docs/queues/api).
* **Supabase Queues/pgmq** is a Postgres-native, pull-based queue. The existing
  event pipeline uses PGMQ for domain events, but cache-invalidation outbox
  rows are not published to that queue and no wake/HTTP consumer is configured.
  Adding a queue alone would add another poller, not wake the VPS. See
  [Supabase Queues](https://supabase.com/docs/guides/queues),
  [pull-based quickstart](https://supabase.com/docs/guides/queues/quickstart),
  and [pgmq](https://supabase.com/docs/guides/queues/pgmq).
* **Cloudflare Queues** requires a queue binding and a Worker consumer in
  Wrangler. The repository has no queue binding or Worker consumer for cache
  invalidation. Cloudflare's consumer is at-least-once and retries failed
  batches; it would still need a narrowly authenticated bridge to the existing
  drainer and cannot directly wake this VPS without that bridge. See [Cloudflare Queues](https://developers.cloudflare.com/queues/reference/how-queues-works/).

## Safe implementation shape (future, feature-gated)

When a provider is actually provisioned, add a `CACHE_INVALIDATION_QUEUE_WAKE_ENABLED`
flag (default `false`) and make the queue consumer a *wake hint* only:

1. The source transaction continues to enqueue the durable outbox row.
2. After commit, publish a minimal `{kind: "cache-invalidation-wake", idempotencyKey}`
   message. A publish failure is observable but does not roll back the source
   mutation or delete the outbox row.
3. The consumer authenticates to a dedicated wake endpoint (or invokes the
   existing drainer through a private, provider-supported route). The endpoint
   validates the message, takes the same `flock`, and runs the existing
   claim/finish drain with bounded timeout. It must not accept tenant IDs,
   purge URLs, provider credentials, or arbitrary RPC names from the message.
4. Duplicate delivery is harmless: the database claim token and existing
   idempotency rules remain authoritative. A failed consumer leaves the message
   for retry and the outbox row for the next two-minute sweep.
5. Keep the two-minute cron enabled until an outage drill proves wake delivery,
   retry, replay, and recovery after provider/VPS/web downtime. Only then may
   the sweep interval be relaxed; never remove it without a separately approved
   durability replacement.

Required gates before enabling the flag: provisioned resource and secret
bindings; schema/SDK version pinned; signed/authenticated wake contract;
duplicate, timeout, provider outage, poison-message, and replay tests;
observability for queue depth, wake latency, drain claims, and dead letters;
deployment/readiness verification on the actual VPS and Vercel project; and
owner approval for any cron change.

## Cost and freshness model

Today the worker can make at most `60 / 2 = 30` Vercel calls per hour per
installed schedule. Keeping the sweep means a wake path initially changes
latency, not the invocation ceiling: the effective discovery bound is
`min(wake latency, 120s fallback)`, capped by provider/VPS outages.

If (and only if) the fallback is later relaxed, expected empty-drain calls are
approximately `sweeps_per_hour × fraction_of_empty_sweeps`; queue costs then
add one publish plus one delivery/read per wake, with retries charged again by
the provider. Measure actual queue volume and Vercel function duration before
claiming savings. No percentage or dollar reduction is forecast by this
proposal.
