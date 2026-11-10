# Local sandbox, Orbit checkout and CWV — 3 November 2026

Frozen platform base: `a22bf2cceeac3de81919f011bbb85c691e69e7e7`, plus the recovered uncommitted feature. No feature code changed in this run. Source hashes match the recovery inventory. This is local qualification evidence, not production activation or a release approval.

## Runner and storefront

The existing local Colima VM was restarted with `--activate=false`; the active Docker context was not changed. Existing runsc and root filesystems survived. Trusted workers and workspace SDK/shared sources were rebuilt with `apps/web/experience-runtime/build.mjs`, producing the recorded fresh toolchain digest. Compile stayed in nonroot read-only gVisor jobs with no egress. One live compile test and all three private-authoring files / four tests passed, including normal-owner upload/build/private preview and revocation. Production-mode Next build and TypeScript completed, then Orbit started at http://localhost:43178/qa1 against disposable PostgreSQL 17 / PostgREST, not a hosted project.

The synthetic catalog intentionally does not mirror unrelated platform blog/merchant data. Build logs reported missing unrelated fixture columns/tables and absent Ogabassey rows; these do not establish a full web test pass or full tenant coverage. Current production composition is still disabled by `src/lib/experience/profile-validation.ts`, which requires `local-synthetic` and rejects production. This fixture installs a trusted local public-read profile directly; it is not a production enablement path.

## Checkout proof

Desktop 1440×900 and mobile 390×844 both passed custom colour interaction, add-to-bag, image decoding, NGN totals, native Baci checkout handoff, synthetic contact/address entry, the merchant delivery quote and final payment review. Desktop: one ₦250 item + ₦1,500 shipping = ₦1,750. Mobile retained the same guest cart and added a second item: ₦500 + ₦1,500 = ₦2,000. Pay on Delivery was selected, making Place Order available; it was never clicked. Final local database order count was zero.

Mobile handoff used keyboard activation after the first pointer attempt did not navigate; subsequent checkout controls worked with ordinary pointer actions. This is browser viewport/touch emulation, not physical-device or Mobile Safari certification. Manual-address fallback was used because Places credentials are intentionally absent; its local autocomplete endpoint returned 500. Courier/geocoded-provider quoting is not qualified. One rapid multi-field edit displayed the rate retry card. The manual refresh and a later automatic single-field refresh both returned HTTP 200. These observations are preserved in the receipt rather than presented as a pristine error-free journey.

Screenshots and action summaries are retained here. No raw tokens, cookies, authorization headers or HAR bodies are copied into these public-safe artifacts.

## CWV diagnostics: not qualified

All 24 captures completed: three cache-disabled navigations for each of four routes at each viewport. Native connectivity, no CPU throttling beyond the benchmark container's two-CPU limit, prepared backend. Browser: Chrome 151.0.7922.169 in the already-cached pinned local sitespeed image. No image pull or paid service was used. The in-app browser's observer/timeline instrumentation was unavailable and the shared DevTools profile was occupied; neither protection was bypassed and no peer browser was stopped. The standalone benchmark test used its own disposable containers.

Composite LCP below is the maximum of host LCP and child-frame LCP offset from host navigation. This avoids reporting only the faster inner-frame timing. P75 uses nearest rank on just three samples per cell and is not a field statistic.

| Width | Route | Median composite LCP | Small-sample p75 | Max post-paint CLS |
|---|---|---|---|---|
| 390 | /qa1 | 1.42s | 1.90s | 0.000000 |
| 390 | /qa1/collections/all | 1.91s | 3.08s | 0.000000 |
| 390 | /qa1/phones/synthetic-device | 3.24s | 7.73s | 0.000000 |
| 390 | /qa1/pages/story | 1.63s | 1.82s | 0.000000 |
| 1440 | /qa1 | 2.40s | 2.64s | 0.000000 |
| 1440 | /qa1/collections/all | 1.64s | 2.02s | 0.000000 |
| 1440 | /qa1/phones/synthetic-device | 1.26s | 1.29s | 0.000000 |
| 1440 | /qa1/pages/story | 1.83s | 2.17s | 0.000046 |

**All 24 samples are contaminated by shared-Mac load.** Some LCP samples also exceed both the requested 1–2 second goal and the standard 2.5-second good threshold. No timing waiver or pass is granted. Maximum observed CLS was below 0.00005; recorded interaction event durations were 16–72 ms where captured, but these are not field INP. Three-per-cell local timings cannot establish future stores' field CWV. See [Google's metric definitions and thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds).

Eight HAR files covering the benchmark showed only the two loopback origins, zero HTTP errors and zero order/payment writes. Raw HARs remain ignored locally. `lab-samples.json` retains every capture; `network-audit.json` is sanitized.

## Publishing remains blocked

Before merchant publishing: qualify timing on a quiet/representative runner; implement and review production composition plus isolated build/execution/HTTPS delivery integration; create the immutable reviewed candidate and obtain required exact-head CI/full release checks; then obtain separate approval for schema/config rollout, deployment and publication. Current local HTTP/cookies and fixture tests do not qualify production TLS, real carrier pricing, order/payment execution or hosted OAuth.

The preview and disposable database remain running for review. Temporary benchmark reverse forwards are removed after measurement; the user browser's cache/touch/viewport overrides are reset. No publishing, hosted migration, production change, order, payment or extra AI-provider cost occurred.
