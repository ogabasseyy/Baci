# Focused Vercel comparison CPU fix — 2026-09-08

## Scope and observed hotspot

The production audit for 2026-09-07 UTC attributed 29,759,149 of
39,849,327 active CPU milliseconds (74.68%) to
`/[slug]/[category]/compare/[comparisonSlug]`, across 10,250 invocations.
This is a one-day project observation, not a forecast of the whole invoice.

Three Terra workers handled four issue assignments; one worker handled the
graph and soft-404 assignments sequentially. The parent reviewed the combined
diff and ran separate boundary/parity checks.

## Review decisions

| Issue | Included change | Limit / remaining action |
| --- | --- | --- |
| Redundant graph CPU | Lazily calculate curated approval only when needed; retain the existing supplemental bound and unvalidated-candidate checks. | Production CPU improvement must be measured after deployment. |
| Repeated local manifest calculation | Retain local caching and add a regression protecting inventory failures from becoming cached empty approval sets. | Remote-cache proposal rejected: another instance can refill it from stale local inventory. A durable inventory revision or cross-instance-valid fill is required first. |
| Expensive comparison misses | Check the existing maintained manifest without constructing a redundant curated graph or allocating a one-use Set. Only brand comparisons build the separate curated graph. | HTTP status remains unchanged. A safe pre-streaming hard 404 needs fresh bounded route authority; do not restore Proxy self-fetches. |
| Failing wallet HMAC cron | Fail production deployment before build when the required key is absent from Vercel's pulled Production configuration. | Presence is not value/usability proof. Provision the established approved value, at least 32 characters, then verify the actual deployed cron. No secret is generated, copied, or rotated here. |

## Independent synthetic CPU measurement

Parent compared the exact base revision
`d50bbd621c8b691e6672e289a6049843dc52e047` with the changed working-tree
graph modules using Node 24 `process.cpuUsage()`. Module loading was outside
the measurement. For each size, three manifest builds used synthetic active
products with distinct chipset/RAM/storage/battery specs. Emitted route sets
were deeply equal on every comparison.

| Products | Median base CPU | Median changed CPU | Identical routes |
| ---: | ---: | ---: | ---: |
| 150 | 253.67 ms | 42.42 ms | 1,164 |
| 300 | 594.38 ms | 205.95 ms | 2,364 |
| 600 | 1,413.42 ms | 639.24 ms | 4,764 |

Anchored graph output parity also passed for maxLinks
0, 1, 3, 8, 12, 80, 150, 151 and 200. Dedicated tests cover the 150-candidate
supplemental boundary, unvalidated candidates, and empty input.

The 600-product result is approximately 55% less CPU **inside this helper**.
It is not an end-to-end request speedup, cache-hit claim, or invoice-saving
estimate. Neither this branch nor a PR merge is a production deployment.

## Deployment and validation boundary

The full-suite check also exposed an existing inventory seal pointing at a
branch-only commit. Canonical regeneration against current main changed only
`originMainSha` and `inventorySha256`; all 558 rows and source digests remained
identical. The artifact and its pinned validation expectation are re-anchored
to the reachable base above without changing inventory policy.

Do not merge/deploy the configuration guard without first configuring
`MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET` in Vercel Production. Sensitive
values are intentionally unreadable in local pull output, so the gate does
not attempt value readback. The existing runtime validation remains authoritative.

No changes to Proxy, public response caching, checkout, payment authority,
credentials, or production scheduling are included. Observability Plus was
disabled separately during the audit; this PR does not need it re-enabled.

After an approved prebuilt deployment, compare the same route cohort and
time window: active CPU per invocation and total CPU, cache refills, memory,
remote-cache/ISR writes, and origin transfer. Smoke-test valid/reversed
comparisons, brand comparisons, known misses, product/category changes, and
checkout. Review any cost shifted to other services rather than counting it
as a saving.
