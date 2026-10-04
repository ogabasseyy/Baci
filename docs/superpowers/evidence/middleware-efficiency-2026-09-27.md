# Middleware efficiency: offline stage evidence

Date: 2026-09-27. Baseline: `58d402a20f1aa5188239cc114e091ebc6020d74d`.
Candidate: the uncommitted `codex/middleware-efficiency` change based on that SHA;
record the final candidate SHA when publishing or comparing production windows.

## What was measured

The reusable [stage measurement test](../../../apps/web/src/lib/proxy/middleware-efficiency.measurement.test.ts)
runs the real routing and preflight orchestration functions with 100 requests per
class. It spies on both real pathname normalizers, stubs the forward-domain and
slug-alias resolvers, and returns neutral verdicts from the five preflight helpers.
Any attempted `fetch` fails the test. No production instrumentation, logs, provider
calls, or network telemetry are added.

Candidate: 13 tests passed, 1,300 stage invocations. Baseline: the same 13 cases
passed against the three stage modules extracted with `git show` from the exact
baseline SHA. For that isolated baseline run, imports of those three modules in a
temporary copy of the harness pointed to the extracted files. Dependencies and
mocks came from the working checkout, so this is an isolated stage comparison,
not a complete baseline application execution. Temporary copies were removed.
The full-checkout reproduction below avoids that distinction.

| Stage and request class | Requests | Baseline calls | Candidate calls |
| --- | ---: | ---: | ---: |
| Forward custom-domain resolver: subdomain GET `/api/orders` | 100 | 100 | 0 |
| Forward custom-domain resolver: subdomain POST `/api/orders` | 100 | 100 | 0 |
| Forward custom-domain resolver: subdomain POST `/products/phone` | 100 | 100 | 0 |
| Forward custom-domain resolver: subdomain GET `/products/phone` | 100 | 100 | 100 |
| Forward custom-domain resolver: subdomain HEAD `/products/phone` | 100 | 100 | 100 |
| Each pathname normalizer: canonical ASCII `/products/phone` | 100 | 100 | 0 |
| Each of five preflight helpers: RSC GET | 100 | 100 | 0 |
| Each of five preflight helpers: router-prefetch GET | 100 | 100 | 0 |
| Each of five preflight helpers: router-state GET | 100 | 100 | 0 |
| Each of five preflight helpers: fetch-destination `empty` GET | 100 | 100 | 0 |
| Each of five preflight helpers: POST | 100 | 100 | 0 |
| Each of five preflight helpers: document GET | 100 | 100 | 100 |
| Each of five preflight helpers: document HEAD | 100 | 100 | 100 |

Across this synthetic fixture mix, 300 forward resolver dispatches, 200
normalizer dispatches, and 2,500 async preflight helper dispatches disappear.
Those totals are deliberately **not weighted estimates of production savings**.
The fixtures measure independent stages, not 1,300 complete middleware requests.
Other targeted tests cover redirects, exceptional path normalization, cache
isolation, and preflight precedence; this harness checks repeated call budgets.

## Interpretation and limits

- The subdomain change skips an optional forward-domain resolution. The production
  resolver in `domain-cache-simple.ts` first checks a warm Edge Config mapping,
  then Edge Config, then the fallback memory/database path. One eliminated helper
  call therefore does not imply one eliminated database or Edge Config request.
  Warm positive caches and single-flight behavior already exist in the baseline.
  Required retired-slug and custom-host identity resolution remain outside these
  savings counts.
- The canonical ASCII guard avoids both normalization helpers and the URL parse
  used by the cache-safe normalizer branch. This test counts helper entry, not
  individual allocations, decode operations, or active CPU time. Escaped,
  uppercase, and non-ASCII paths keep their existing normalization behavior.
- Non-document preflights previously entered five async helpers, each of which
  already rejected these requests before external resolution. Blog and compare
  use `isEligibleForHardStatusPreflight`; PDP hard status uses document-navigation
  classification; PDP canonicalization has equivalent method/header guards.
  Thus their baseline external/database reads were already zero. The new guard
  removes helper/promise overhead; it is not a database round-trip reduction.
  The harness stubs helper bodies and does not measure their internal CPU cost.
- RSC/public cache eligibility changes harden cache isolation. They are not counted
  as savings; preventing an unsafe public-cache hit can increase origin work.

Local environment: Node `v24.11.1`, pnpm `11.7.0`, Vitest `4.1.11`.
The candidate run reported 76 ms in test bodies / 1.06 s total; the isolated
baseline run reported 72 ms / 1.49 s total. These single-run wall-clock values
include mocks, assertions, request construction, and runner overhead. They do
not show a reliable runtime speedup and are not active CPU, GB-hours, or billed
cost measurements. Call counts are the reproducible evidence here.

## Reproduce without production traffic

Use two separate checkouts with the same Node/pnpm versions and local dependencies:
one at the baseline SHA above, one at the final candidate SHA (or this task's
working checkout). Keep unrelated dirty checkouts intact. Copy only
`apps/web/src/lib/proxy/middleware-efficiency.measurement.test.ts` unchanged from
the candidate into the baseline checkout; do not copy runtime modules. Install
dependencies from the lockfile using the existing local store if needed.

In the baseline checkout:

```sh
git rev-parse HEAD
BACI_MIDDLEWARE_MEASURE_BASELINE=1 pnpm --filter @baci/web test src/lib/proxy/middleware-efficiency.measurement.test.ts
```

In the candidate checkout, with the baseline flag unset:

```sh
git rev-parse HEAD
git diff --stat
pnpm --filter @baci/web test src/lib/proxy/middleware-efficiency.measurement.test.ts
pnpm exec biome check apps/web/src/lib/proxy/middleware-efficiency.measurement.test.ts
```

The flag changes expected call budgets only. It does not switch runtime source:
running baseline expectations on candidate code should fail. Capture both SHAs,
dirty diffs if any, tool versions, and the test results together. Do not use this
mocked harness to extrapolate latency percentiles or dollar savings.

## Production measurement still required

No deployment, production before/after window, or dollar savings was measured.
After an authorized deployment, compare existing provider metrics over equal
traffic windows, recording both deployment SHAs, window duration/time, request
volume, host/path/method mix, document/RSC/prefetch mix, geography, concurrency,
and cold/warm instance mix. Control for bot spikes and concurrent releases.
Use existing aggregate metrics first; this change adds no paid telemetry.

Collect middleware invocations and active CPU, provisioned-memory GB-hours (or the
provider's actual applicable memory usage meter), external Edge Config/database/
internal resolution calls, and CDN/origin cache hits and misses. Normalize both
raw totals and per-request values to comparable traffic classes. Document request
latency separately from active CPU: waiting for a network response is not the same
meter. Verify correctness/error rates alongside any cache-hit changes.

Only apply the account's actual billing meters and contracted rates after that
comparison, including allowances and credits. Invocation count may remain
unchanged because matcher coverage is unchanged. Net savings remain unmeasured;
the evidence currently supports reduced stage work for the specified classes.
