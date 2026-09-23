# Storefront cost measurement

This runbook measures the cost effect of the storefront cache changes without
attributing project-wide billing to a single route. Capture a comparable UTC
window before and after each production deployment; use the same duration,
traffic cohort, and route sample in both windows.

## Inputs

* Vercel FOCUS billing JSONL export for project `prj_y6kGI7ZzyFWU6tyZbaklPtVsXeqx`.
  Keep the original export immutable and record the deployment SHA that was
  active during the window.
* A sampled cache-probe JSONL file with one row per request and only these
  optional fields: `cacheStatus` (`HIT`, `MISS`, or another provider value) and
  `ttfbMs` (non-negative number). Sample the same PDP, compare, and blog route
  cohorts before and after; this is a sample, not a census.
* A bounded DB trace JSONL file with one row per sampled request. Each row must
  contain integer `dbCalls` and may contain integer `dbTimeouts` plus a safe,
  low-cardinality `cohort` such as `pdp`, `compare`, or `blog`. Produce it from
  Supabase query telemetry or bounded OpenTelemetry spans; do not put URLs,
  tenant identifiers, or SQL text in this artifact.

## Produce a comparison

The bounded parser validates dates, numeric quantities, project tags, file size,
row count, and source hashes before producing a JSON artifact:

```bash
pnpm --filter @baci/web exec tsx \
  tools/cost/measure-vercel-storefront-cost-cli.ts \
  --project-id prj_y6kGI7ZzyFWU6tyZbaklPtVsXeqx \
  --before before.jsonl \
  --before-sha <40-character-before-sha> \
  --before-label pre-3428 \
  --before-window-start 2026-08-01T00:00:00.000Z \
  --before-window-end 2026-08-02T00:00:00.000Z \
  --before-cache-probe before-cache.jsonl \
  --before-db-trace before-db.jsonl \
  --after after.jsonl \
  --after-sha <40-character-after-sha> \
  --after-label post-3428 \
  --after-window-start 2026-09-03T00:00:00.000Z \
  --after-window-end 2026-09-04T00:00:00.000Z \
  --after-cache-probe after-cache.jsonl \
  --after-db-trace after-db.jsonl \
  --out storefront-cost-measurement.json
```

The output reports project-level effective cost, function duration,
invocations, Fluid CPU/memory, Global Config reads, ISR reads/writes, runtime
cache reads/writes, cache hit ratio, and p50/p95 sampled TTFB. For Vercel
`x-vercel-cache` samples, `HIT`, `STALE`, and `PRERENDER` count as cache hits;
`MISS`, `BYPASS`, and `REVALIDATED` do not. A comparison is omitted unless an
after window is supplied. `comparisonStatus` is `complete` only when both
before and after DB traces are supplied; otherwise it is `incomplete` (or
`not_available` when there is no after window), and no DB deltas are emitted.
When both DB trace inputs are supplied, the comparison also reports DB calls,
DB timeouts, and calls per sampled request, with cohort-level detail retained
on each window. Reports written with `--out` replace the destination
atomically using a private `0600` file.
When both cache probes are supplied, the comparison also reports cache-status
rows, cache-hit rows, and cache-hit ratio; a one-sided probe remains window
metadata only rather than an inferred delta. Empty DB-trace files and
half-specified requested windows are rejected as incomplete evidence.

## Interpretation

* Compare per-request or per-session rates as well as totals; traffic changes
  can otherwise look like a caching win or regression.
* Treat an `incomplete` comparison as measurement work still outstanding. Do
  not present project-cost deltas as a complete storefront savings claim until
  both DB traces and comparable route samples are present.
* A lower ISR-write count is expected from the longer TTL, but targeted
  invalidation may add event-driven writes. Attribute those separately.
* A lower Global Config read count is expected from the warm-instance mapping
  cache. The result is bounded by instance reuse and must be measured, not
  extrapolated from the historical charge alone.
* In-flight invalidation coalescing only removes overlapping duplicate provider
  calls. Sequential retries remain visible and should not be counted as saved.
* Keep the two-minute invalidation sweep in the denominator until a queue wake
  path is provisioned, tested, and observed in production.

## Expected function-work accounting

The report intentionally separates measured work from a forecast:

* Static `/_next/static/*` assets do not execute a Vercel Function, so their
  immutable browser/CDN header should not increase function duration or
  invocations.
* For one in-flight invalidation key, provider work falls from `k` duplicate
  calls to one call, a maximum reduction of `1 - 1/k`; settled retries remain
  billable and are deliberately not hidden.
* The two-minute fallback has an upper bound of 720 sweeps (and therefore
  Vercel route invocations) per 24 hours. A queue wake path only reduces that
  work after the fallback is safely relaxed; use `empty_sweeps` and
  `queue_wake_deliveries` from production telemetry to compute
  `(empty_sweeps - wake_deliveries) / total_sweeps`. Do not claim a percentage
  until those counters and retry deliveries are measured.

## Minimum acceptance evidence

Store the raw exports, SHA-256 hashes, deployment SHAs, route-sample counts,
DB-call counts, and UTC windows together. Report absolute and percentage deltas
for function duration, invocations, cache hits, and DB calls; do not claim a
dollar saving when the source window or project attribution is incomplete.
