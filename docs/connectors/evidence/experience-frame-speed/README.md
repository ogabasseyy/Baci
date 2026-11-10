# Local frame delivery and authoring budgets — 2026-10-26

This is local synthetic-data evidence, **not release or field-CWV qualification**.
The isolated worktree is based on current main as inspected for this work:
`8b13afa9f7fa798f3aec2474318f67bbfc8b7dde`. The exact 33-file task scope and
served web build ID are in [source-binding.json](source-binding.json). The
inherited integration is outside this incremental review scope.

## Changes

- Cache bounded public SSR fragments by the exact binding, manifest and public
  bootstrap. Each delivery still reads normal-RLS publication/catalog state,
  checks retained artifacts and rechecks freshness after rendering. Authority,
  private cart state and customer sessions are never cached in the fragment cache.
- Prepare four public routes at trusted local startup. Uncached rendering still
  uses the existing gVisor boundary. Preparation time is startup work, not a
  visitor LCP measurement.
- Parallelize independent read-only resource/catalog lookups while preserving
  before/after publication guards.
- Load the public frame while admission is pending, keeping it hidden and inert.
  Admission, bridge connection and presentation all gate visibility. Presentation
  and fallback removal now share the controller update, avoiding a transient
  double-height host layout. Rejected verification clears admission.
- Load commerce implementation only for cart/checkout requests. Recheck the
  original route, generation, publication and shopper identity after import and
  preserve normal Baci command-port admission around effects.
- Give the consent banner independent fixed geometry rather than depending on
  a legacy storefront stylesheet.
- Expose a fixed `starter-v1` budget through MCP capabilities and reject oversized
  verified build output before acceptance/capture/finalization. Preserve the
  validated failure category in both text and structured MCP results.

| Checked resource | Raw byte ceiling |
| --- | ---: |
| Compiled JavaScript | 262,144 |
| Compiled CSS | 32,768 |
| Prerender proof HTML | 131,072 |
| Individual PNG asset | 262,144 |
| Individual WOFF2 asset | 131,072 |

These are starter build ceilings, not an aggregate page-weight limit or a timing
guarantee. The prerender proof checks the supplied bootstrap; it does not prove
every possible dynamic route/data state. MCP advertises a stricter 2,000ms LCP
authoring target while retaining `fieldQualification: not-established`.

Orbit's observed delivered resources were 207,856 bytes of JavaScript, 8,751
bytes of CSS and 6,871 bytes of initial HTML. Small resources alone did not
eliminate host loading, RLS checks and frame startup latency.

## Verification

See [validation.json](validation.json) and [reviews.json](reviews.json).

- Experience suite: 84 files / 182 tests passed. The subsequent presentation
  follow-up passed its focused Frame/Shell checks: 2 files / 8 tests.
- Runner suite: 30 files / 79 tests passed.
- MCP registry, evidence and result-envelope checks: 3 files / 9 tests passed.
  The generated output contract initially drifted and was regenerated; the
  structured-result regression failed before the wrapper fix and passed after it.
- Final storefront source passed a normal local production build including
  TypeScript. The standalone MCP follow-up passed its dedicated TypeScript check.
  A fixture-only Redis configuration rebuild used Next's compile/generate phases
  against the unchanged, already typechecked storefront source.
- Biome passed the task scopes. Three included-allowance CodeRabbit reviews
  reported zero issues: initial 30 files, presentation follow-up 4 files, and
  MCP wire/envelope follow-up 3 files. Hashes bind their combined final scope.
- Live public-cache tests cover reuse, price-change refresh, missing/withdrawn
  publication and revocation. Scoped analytics tests reject absent/wrong-tenant
  capabilities. These are not a full production-security or monorepo-test verdict.

The disposable production fixture initially lacked Redis. Normal anonymous cart
bootstrap correctly failed closed with 429; restarting alone did not fix it.
The fixture now uses socket-only local Redis through a loopback Upstash-compatible
transport. Tests execute actual Redis Lua through the installed Upstash SDK and
verify counter increments, expiry and denial at the configured limit. No cart
quota, auth or RLS check was disabled.

## Commerce browser checks

[checkout-proof.json](checkout-proof.json) records final desktop 1440×900 and
Chrome mobile emulation 390×844 journeys:

1. Orbit home → product → normal synthetic cart creation/addition.
2. Bag image and NGN currency display.
3. Baci's native checkout, synthetic contact/address entry and normal shipping API.
4. Synthetic local delivery ₦1,500 plus product ₦250 = ₦1,750.
5. Final payment-method review with Place Order enabled but **never clicked**.

Visible checkout images decoded and neither viewport overflowed. Cart bootstrap
and creation returned 201; command, checkout-preparation and shipping requests
returned 200. The initial guest cart read returned the expected 401 before a
cart proof existed. Read-only SQL against this disposable fixture confirmed zero
orders after both journeys; observed order/payment request count was zero.

Address autocomplete is intentionally unconfigured and returns 500 in this local
fixture. Its manual-address fallback and merchant shipping quote were verified.
No provider key or paid request was added. This known warning is not a clean
production-provider validation. A missing local synthetic PNG was also restored
from the retained synthetic asset; the final checkout image decoded successfully.

## Performance outcome and open gates

All results below use native connectivity, a prepared local server and fresh
browser containers. Mobile is Chrome emulation, not physical iPhone/Safari or a
controlled slow-4G qualification. The shared 12-core host was busy, with load
averages substantially exceeding its CPU count. HAR/video stay in the ignored
scratch paths recorded in [browser-diagnostics.json](browser-diagnostics.json).

- Final desktop diagnostic: actual 1440×900, host/frame CLS 0, real custom-frame
  LCP from host navigation approximately 2.31s.
- First final mobile diagnostic: approximately 1.94s, host CLS 0, **frame CLS
  0.8968**. This is a retained failing outlier, not a pass.
- A subsequent instrumented mobile diagnostic and three more fresh mobile runs
  recorded zero host/frame CLS. The three-run LCP range was 2.005–2.192s, median
  2.116s. Instrumentation records shifted nodes/rectangles; these clean repeats
  had no shift entries. The earlier outlier remains unexplained.
- A second three-run mobile batch additionally recorded the host presentation
  timestamp. All three had zero host/frame CLS and no shift entries; frame LCP
  from navigation was 1.024–1.248s (median 1.098s), just after the recorded frame
  presentation. These are fresh-browser, prepared-server diagnostics under
  variable shared-host load, not proof of an idle-host or universal timing bound.
  The actual HAR browser version is Chrome 151.0.7922.169 with iPhone 12 Pro
  emulation; the image's startup banner is not the browser-version evidence.
- A previous desktop attempt measured 1439px instead of 1440px and was rejected.
  The harness now applies and verifies exact desktop device metrics before loading.

Remaining release gates are an explanation or reliable reproduction/fix for the
retained mobile outlier and a clean, idle-host production-build matrix with three
cold samples on home, collection, product and editorial routes on both profiles,
plus separate Lighthouse/video/network review. A field-CWV claim additionally
requires sufficient real-user percentile evidence after separately authorized
release. No universal future-store LCP guarantee follows from this prototype.

The implementation and preview remain local. Nothing was published, merged or
deployed; no orders/payments were submitted and no paid AI-provider API was used.
