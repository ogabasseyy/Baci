# Checkout architecture and performance audit

## Scope and verdict

PR #3499 completed its review loop and was merged on 25 September 2026.
Submission/recovery work continues in one
[payment orchestration follow-up](2026-09-25-checkout-payment-orchestration.md).
The production deployment failed before building, in the shipping-policy
migration. Merge, deployment and production verification remain separate actions.

The checkout uses current React/Next capabilities, but its overall implementation
cannot yet be described as fully modernized. The browser regression gate is a
substantial improvement. Large submission/API modules, incomplete live provider
evidence and unmeasured production performance remain material gaps.

## Confirmed fixes added during this audit

| Problem | Change | Regression evidence |
| --- | --- | --- |
| Every state selection fetches a city list that checkout never uses | Remove the unused request and state; retain address detection and the state vocabulary lookup | Select a different autocomplete address and verify its city/state remain visible with zero city-list requests |
| Checkout tax preview depended on a remote pure-math request, so totals could be stale, pending or fail during submission | Extract the Edge function's exact preview arithmetic and use it synchronously in checkout; retain the order route's canonical per-line validation | Fractional, zero-rate and default-rate parity cases; checkout updates its preview immediately when subtotal, shipping or tax rate changes |

The unused-lookup regression reproduced two unnecessary requests before removal
and zero after removal, while preserving the detected address. The old totals
request race was reproduced with deferred responses. Review then exposed that a
current pending calculation could submit zero tax. Checkout no longer makes that
request: its preview now uses the same arithmetic as `calculate-commerce`, so
there is no pending/error/retry state or stale response to submit.

The order API remains authoritative: it recomputes canonical per-line tax and
validates the submitted expected total. The synchronous helper is only a UI
preview and deliberately keeps the Edge function's aggregate rounding behavior;
it does not replace server pricing or provider validation.

## Static bundle observation

Measured the existing production-built isolated checkout fixture at PR source
commit `e647a02dabab5f1ce77542a36711ea38be13d892`, before the race fixes.
Build ID: `2vbR_xKZ2GTKgeAtSo8Sa`.

Method: read external script references from
`apps/web/tests/checkout-browser/harness/.next/server/app/checkout.html`, resolve
them to the fixture's static JavaScript files, and sum file bytes and Node zlib
`gzipSync` lengths. This excludes inline scripts and subsequent dynamic loads.

| Fixture observation | Value |
| --- | ---: |
| Initial external scripts | 15 |
| Raw JavaScript bytes | 2,560,554 |
| Estimated gzip bytes | 682,610 |
| Largest chunk, raw bytes | 1,388,069 |
| Largest chunk, estimated gzip bytes | 351,833 |

These are build-artifact measurements, not production transfer bytes, LCP,
INP or a measured speed improvement. The largest chunk combines many modules;
its whole size must not be attributed to a single package.

The local disk had about 5 GiB free. The repository's storefront measurement
protocol requires 10 GiB before a video-performance batch, so that batch was
not started. Existing browser CI covers behavior, not a production performance
comparison.

## Prioritized remaining work

| Priority | Evidence | Improvement and acceptance criteria |
| --- | --- | --- |
| High | `checkout-page.tsx` remains 3,226 lines; `handlePlaceOrder` mixes order creation/reuse, auth and provider transitions | Extract typed submission/recovery boundaries by responsibility. Preserve duplicate-submit fences, indeterminate-payment reconciliation and order identity. Cover each provider's success, cancellation, response loss and retry before moving its branch. |
| High | `/api/orders/route.ts` remains 3,243 lines with legacy privileged data operations | Separate parsing, pricing/delivery, idempotent creation and post-commit work. Replace privileged edges only through narrowly scoped database contracts with disposable-DB guest/tenant/authorization tests. No expired exception is renewed by this PR. |
| Medium | `ui/phone-input.tsx` eagerly imports the complete `react-phone-number-input/flags` map | Measure isolating the country picker/flags from initial checkout JavaScript. Preserve international selection, accessible names, keyboard behavior and existing asset/CSP rules. Compare emitted chunks and matched browser traces; do not assume a byte saving. |
| Medium | Checkout imports analytics from `@baci/shared/contracts`, whose public barrel spans multiple domains | Evaluate focused public exports/imports, then compare bundle output. Avoid a blanket `sideEffects: false` claim without checking package initialization. Shared package changes require consumer and monorepo validation. |
| Medium | Browser fixture mocks auth, orders, shipping and payments | Add staging evidence for actual sign-in, tenant routing, provider cancellation, webhook reconciliation and retry. A mocked payment handoff does not prove a charge or fulfillment. |

## Existing good decisions to preserve

- React Compiler is enabled. Follow the repository rule against manual
  `React.memo`, `useMemo` and `useCallback` additions.
- Optional crypto/auth dialogs already use deferred loading; payment SDKs load
  when opened. Assess actual initial chunks before adding more lazy wrappers.
- Persisted checkout input already debounces session storage and flushes on
  page hide. Replacing that with per-keystroke storage writes would regress it.
- Shipping quote loading already uses abort, request sequencing and request
  identity. The obsolete city request was removed after verifying it had no
  consumer; the required state vocabulary lookup remains.
- The resume loader uses `useEffectEvent` for current callbacks while the
  request is keyed to order identity, avoiding repeated hydration fetches.

## Current guidance used

- [React effects and cleanup](https://react.dev/reference/react/useEffect):
  cancel or ignore obsolete asynchronous work; extract effects around coherent
  responsibilities.
- [React Effect Events](https://react.dev/reference/react/useEffectEvent): read
  current values from effect events without concealing reactive dependencies.
- [Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading): defer
  conditional client code; a dynamic component rendered immediately still loads
  immediately.
- [Web Vitals](https://web.dev/articles/vitals): measure LCP, INP and CLS for the
  user experience. Bundle bytes and lab TBT are not substitutes for those data.

Use `docs/perf/storefront-visual-regression.md` for a matched before/after run
with the same route, build topology, browser, cache and throttle. Keep this audit
separate from the current-head CI/review receipt, which changes after every push.
