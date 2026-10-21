# OgaBassey layout, streamed hero and JavaScript verification

## Verdict and scope

The local implementation fixes three identified layout mechanisms and emits
authorized hero content in visible initial HTML. It is ready for PR review, not
an assertion of production CWV improvement. Nothing was deployed.

Runtime source commits: `3149f07475` and
`2f5f5699376f3a4c4ade44d4f7e886d639b093b4`. The branch incorporates main through
`4af36fcc4b`; that later base update changes native/MCP configuration, not the
storefront runtime exercised here. The approved route-inventory snapshot is
generated from exact source commit `2f5f5699376f3a4c4ade44d4f7e886d639b093b4`,
with 584 rows and SHA-256
`57375622a7287834048e78aac7437fd3f7046fdd9c5456bd6b217aa0d82e1f32`.

Changes:

- Give the streamed main region a stable viewport minimum so the footer cannot
  initially occupy its space and then jump away.
- Keep independently streamed maintained catalog links after the product list,
  instead of inserting them above already-painted products.
- Size the ad frame, not only its percentage-sized child. Mirror its responsive
  widths in the existing inline critical CSS, preserving delivery and cascade.
- Use the canonical home route's existing merchant/publication/layout guards,
  passing resolved hero data into the existing renderer. Blog/PDP routes retain
  their own layouts and do not await the home feed.
- Render a meaningful geometry-matched hero fallback from caller-authorized
  slides, with native product links, the correct document heading, and no eager
  mobile image when another surface owns LCP.
- Defer the legacy BlogSnippet SDK import until the existing bounded LCP or
  interaction signal; cancel after navigation. Existing cart/PostHog deferrals
  were retained rather than duplicated.

## Structural build evidence

Both arms use local production-mode builds with the repository's existing
preview catalog-enumeration cap. This is not deployment-environment parity.
The final candidate build exited 0. BUILD_ID is not a unique identifier in this
repository; artifact hashes and source receipts identify the comparison.

| Build-output observation | Frozen control | Final candidate |
| --- | ---: | ---: |
| First mobile hero title byte offset | 74,458 | 41,800 |
| Hidden ancestor of that title | `S:8` | none |
| Head script files | 24 | 22 |
| Sum of separately gzip-compressed head script bodies | 346,230 B | 334,280 B |
| Static document gzip | 18,720 B | 20,249 B |

The served candidate hero panel also arrives in the first static body burst.
No-JS hero visibility/native-link checks pass. Home → blog → home navigation
preserves the client-navigation sentinel, and the cart drawer opens normally.
The hero rotated between builds (Standing Case versus Magnet Case), so these
are structural observations, not a content-matched LCP experiment.

Blog/PDP head-script totals remain unchanged. The BlogSnippet change establishes
a runtime deferral contract, not a measured current-PDP initial-byte saving.

## Layout and browser verification

The complete repository matrix was exercised: 25 route families × mobile and
desktop × three cold browser contexts = **150 navigations**. Native Chrome
149.0.7827.22 used mobile 412×823/DPR2 and desktop 1350×940/DPR1. Each visit
included load, settling and a one-viewport scroll with session-window CLS
collection. These are bounded correctness captures, not field measurements.

- Zero broken visible images across all 150 visits.
- Maximum recorded session CLS: **0.002068**. Small residuals include the
  existing chat anchor and cart content; this is not a universal CLS=0 promise.
- All documents returned HTTP 200; this does **not** count an error-boundary UI
  as functional success. Rewards failed as documented below.
- Desktop products: **0.300619 → 0** in all three before/final samples.
- Desktop search: **0.068594–0.136634 → 0.000554**. The ad-frame horizontal
  resize disappears; the small chat-anchor shift remains.

Those last comparisons isolate the follow-up catalog/ad repairs within this
local implementation. Do not compare them numerically to a different live PSI
profile or claim a production p75 change.

Separate Sitespeed 42.7.0/Browsertime videos cover home/blog/PDP × both viewports.
The actual HAR browser is Chrome 151.0.7922.169 (mobile emulates Moto G4, not the
native matrix's 412px profile). All six report CLS 0. Videos/contact sheets show
styled content remaining visible after its initial paint, without a late blank
or a footer flash. Image, HAR and console evidence is retained.

Separate Lighthouse 13.4.1 checks report **CLS 0 in all six core-page cells**.
Host load was elevated and there is no matched control series, so timing and
scores are informational only. For transparency, simulated mobile LCP was
3.705s home, 3.545s blog and 4.815s PDP; observed local LCP was 262/100/1162ms.
Those are different measurement quantities, not production speed claims.
Sub-2.5s mobile LCP is not established by this work.

## Exceptions and limitations retained

- `/pages/rewards` renders the existing missing `CustomerAuthProvider` error
  boundary in all six matrix visits. The unchanged control reproduces the same
  UI and server error. This separate auth defect is not repaired here.
- One contact desktop visit recorded `Uncaught Error: int64`. One instrumented
  visit per arm did not reproduce it. Both arms load GPT code containing that
  exact throw string, but the original capture lacks its stack, so attribution
  is unresolved. It is not declared harmless or cleared by a clean rerun.
- Anonymous cart requests return 401, and lab `/api/events` requests return 403
  in both arms. The latter remains unresolved. Console/network is not described
  as clean; no proxy or auth policy was weakened to hide these responses.
- Earlier CDP-shaped diagnostics produced hydration failures in both arms.
  Those timings are withheld; the later native/video checks do not retroactively
  validate them.
- No field INP, production p75, uploaded-image budget or CDN improvement is
  claimed. This does not replace a current-head PR review or deployment checks.

## Tests and review

- Failing-first regressions were observed for main/fallback geometry, guarded
  canonical composition, native fallback links/heading, deferred SDK import,
  maintained-link ordering, ad-frame widths and the critical-CSS mirror.
- Final affected web run: **186 files, 1,007 tests passed**.
- Final focused layout run: **25/25**; inventory tests: **7/7**.
- Full monorepo typecheck: **6/6**; pre-commit full lint: **7/7** successful.
  Existing non-failing warnings are not described as a warning-free repository.
- Fresh CodeRabbit follow-up review completed with **zero findings** after the
  final runtime edits. Earlier findings and their evidence-based dispositions
  are retained privately in the review ledger.

Private capture root: `/Users/mac/.codex/cwv-lab-builds/20261021-live-psi`.
It contains build receipts, `build-comparison.json`, `stream-chunks.json`,
`route-matrix-before.json`, `route-matrix-results.json`, navigation checks,
baseline/contact diagnostics, six `final-video-*` bundles, six
`final-lighthouse-*` reports, review receipts and command logs. No environment
files, credentials, customer mutations, payments or deployment artifacts are
included in this PR.

Next gate: current-head PR review and CI. Merge/deploy require separate owner
authorization; only after an approved deployment should unchanged production
URLs be rechecked with PSI and field RUM.
