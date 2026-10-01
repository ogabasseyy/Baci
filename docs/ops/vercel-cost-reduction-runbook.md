# Vercel storefront cost-reduction runbook

This runbook records the August Baci cost baseline, the storefront changes that
reduce repeated work, and the production gates required before longer cache
freshness windows are safe. Repository changes do not rotate provider secrets
or change Vercel dashboard settings.

## Baseline

The supplied August invoice allocation is **$145.98 effective**. The named
line items subtotal **$140.51**; the remaining **$5.47** was outside the named
breakdown and must not be assigned to an engineering lever without the usage
export that identifies it.

| Charge | August USD | Share of named subtotal |
| --- | ---: | ---: |
| Active CPU | 75.70 | 53.9% |
| ISR writes | 20.38 | 14.5% |
| Provisioned memory | 20.06 | 14.3% |
| Origin transfer | 10.33 | 7.4% |
| Global Config | 7.56 | 5.4% |
| Drains | 3.45 | 2.5% |
| Invocations | 3.03 | 2.2% |

The last-24-hour request counts used for prioritisation were PDP **23,308**,
compare **8,033**, and blog **4,692**. Counts alone do not prove that a cache
or rendering change will lower the bill; always pair them with CPU duration,
cache-hit ratio, ISR write count, and transfer bytes from the same window.

## Code levers in this change

### Longer freshness with ordered invalidation

Product, PDP, and compare data now revalidate every **30 minutes** instead of
five minutes. Blog data and blog sitemaps use **60 minutes**. Both retain a
24-hour stale-while-revalidate window so a slow database or cache backend does
not become a storefront hard failure.

Product writes remain event-driven. The exact product stage marks Next cache
tags stale and invalidates the matching Vercel tags. Its generation- and
claim-token-fenced completion then enqueues the broad stage, which covers
listing/category tags and Cloudflare hostnames. Publication transitions retain
foreground hard deletion. Blog mutations invalidate the blog index, category,
post, author, and both sitemap paths in Next and Cloudflare.

Changing a five-minute product revalidation interval to 30 minutes reduces the
maximum opportunity for time-driven regenerations by `1 - 300/1800 = 83.3%`
for entries that remain requested. This is not an 83.3% invoice forecast:
on-demand invalidations, cache residency, request distribution, and writes all
affect the billed result. Book **$0** until the next Vercel usage export.

### Successful Edge Config mapping cache

Successful forward and reverse domain mappings are cached for **60 seconds per
warm instance**, with a 1,000-entry bound and same-process targeted eviction.
Single-flight still coalesces concurrent reads. Misses and provider errors are
not added to the positive Edge Config cache; the existing five-minute database
fallback behavior is unchanged.

For `k` requests for the same mapping on one warm instance during the TTL, Edge
Config reads fall from `k` to `1`, a reduction of `1 - 1/k`. At Vercel's listed
**$3 per million reads**, the supplied **$7.56 Global Config** charge corresponds
to roughly **2.52 million reads**. The maximum removable charge is therefore
$7.56, not a forecast; instance churn and distinct mappings reduce the saving.

### Reliable invalidation drain

The VPS cron wakes under `flock` every two minutes and keeps that discovery
bound until a durable queue wake signal exists. Skipping empty sweeps for up to
30 minutes would also delay work enqueued immediately after a sweep. The local
state file therefore tracks dead-letter transitions without suppressing the
next two-minute call: the same terminal condition is not reported as a new
alert on every sweep, while new invalidations are still discovered promptly.

This change does **not** reduce the worker's maximum 30 Vercel Function
calls/hour. Its cost benefit is limited to eliminating repeated 503/error work;
removing the empty invocations requires a separately proven queue-triggered
wake path. Do not attribute a 15x or 93.3% worker-invocation saving to this PR.

### Bounded degraded reads

PDP semantic, compare-category, and linked-guide reads share one explicit
three-second deadline per operation and disable PostgREST retries. A timed-out
semantic enrichment returns the existing degraded storefront model and enters
a bounded warm-instance cooldown; it does not convert missing enrichment into
a PDP hard failure. Cached render inputs no longer depend on request-time
random values or fallback current timestamps.

## Production rollout gate

Do not ship the 30–60 minute freshness windows while Cloudflare purge
authentication is unhealthy. Before merge/deploy:

1. Rotate the least-privilege Cloudflare Cache Purge token outside the repo and
   update the production secret source used by the prebuilt deployment flow.
   Never paste the token into logs, commits, PR comments, or command output.
2. Verify token authentication and the configured zone with a bounded provider
   probe.
3. Requeue only the known `cloudflare_http_401` dead-letter rows after the
   credential verifies; do not reset unrelated outbox failures.
4. Install the VPS wrapper from the exact reviewed commit and pass the
   drain-readiness check before the production deploy.
5. Deploy through the repository's prebuilt production workflow and verify the
   exact source SHA, live cache headers, successful targeted purge, and cleared
   outbox state.

## Provider-only control: production drain sampling

Lambda and Edge drain sampling is controlled in the Vercel project’s
Observability/Drains settings, not in this repository. The current audit
describes production sampling as **100%**. Reducing that percentage is the only
directly attributable lever for the **$3.45 drains** line, and therefore
requires an owner-operated Vercel change plus a before/after invoice window.

Use this sequence in the Vercel dashboard (owner approval required):

1. Record the current production Lambda and Edge sampling percentages and the
   drain destinations/retention needed for incident response.
2. Trial a lower rate (for example, 10%) for one complete billing week. Do not
   assume linearity until Vercel’s usage export confirms it; the conservative
   upper bound at 10% is a reduction of about **$3.11/month** from the $3.45
   line (90% × $3.45), with **$0** booked until confirmed.
3. Verify that error, payment, and security routes remain observable. If a
   route requires census-level evidence, keep it on an unsampled drain or use
   an independent audit export.
4. Reconcile the next invoice and restore the prior rate if incident coverage
   or provider completeness degrades.

Setting 0% would maximize nominal savings (at most $3.45/month based on this
baseline) but is not an acceptable default because it removes production
drain evidence. No sampling change belongs in this PR.

## Controls deliberately not changed

The following proposals can increase another billable dimension or create a
correctness failure, so they require same-window evidence and a separate
approved change:

- **Shorter revalidation or forced dynamic rendering:** increases active CPU,
  invocations, ISR writes, and likely origin transfer. Reject as a cost fix.
- **Lower function memory:** can lower provisioned-memory charges but often
  increases CPU duration, retries, or timeouts. Keep the explicit memory
  overrides in `vercel.json` until per-route duration and error evidence shows
  headroom.
- **Disabling remote caching or tag invalidation:** can increase CPU, origin
  transfer, and stale-data risk. The remote cache handler intentionally fails
  open on cache backend errors; do not turn those into request failures.
- **Changing region or moving assets:** may alter transfer and latency costs in
  either direction. It needs a measured deployment and route-level transfer
  attribution, not a static configuration edit.
- **Disabling Vercel Analytics/Speed Insights or server telemetry:** saves no
  proven line item in this baseline and removes operational evidence. Treat
  any telemetry reduction as an observability decision, not a cost fix.

## Evidence required before claiming savings

For each proposed change, retain the exact deployment ID, UTC billing window,
route class, request count, active CPU, provisioned memory, ISR writes, origin
bytes, invocation count, and drain sampling percentage. A saving is **proven**
only when the relevant Vercel usage export shows a lower charge without a
material increase in another named line or in error/staleness rates.

## Vercel references

- [Fluid Compute usage and pricing](https://vercel.com/docs/functions/usage-and-pricing)
- [ISR limits, pricing, and optimization](https://vercel.com/docs/incremental-static-regeneration/limits-and-pricing)
- [Next.js revalidation](https://nextjs.org/docs/app/getting-started/revalidating)
- [Next.js CDN caching](https://nextjs.org/docs/app/guides/cdn-caching)
- [Cloudflare cache purge API](https://developers.cloudflare.com/api/resources/cache/methods/purge/)
- [Log Drain sampling rules](https://vercel.com/docs/drains/reference/logs)
- [Edge Config read pricing](https://vercel.com/changelog/pro-edge-config-pricing)
