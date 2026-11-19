# Oxygen slice S-01 — TDD evidence

Dated 5 October 2026 (Africa/Lagos). Worktree `feat/oxygen-integration` from `main@68903f4`.
Requirement source: [contract register](CONTRACT-REGISTER.md) CR-05 (documented samples
only) and [executable handoff](EXECUTABLE-HANDOFF.md) decisions D-02/D-03. No provider
calls; no secrets or provider payloads in fixtures.

Note: the `superpowers:test-driven-development` skill is not installed in this
environment, so the handover's enumerated RED → GREEN → REFACTOR workflow was followed
directly. No RED run is fabricated below; cycle 2's honest outcome (already green) is
recorded as such.

## Cycle 1 — eligibility core shapes (historical setup failure → GREEN)

- Requirement: classify the two documented CR-05 samples; unknown otherwise.
- Test first: `apps/web/src/lib/payments/oxygen/eligibility.test.ts` (11 tests).
- Command: `cd apps/web && pnpm vitest run src/lib/payments/oxygen/eligibility.test.ts`
- RED: suite failed — `./eligibility` unresolvable, 0 tests ran. This is a module-resolution failure, not the required behavioural RED.
- Change: new `apps/web/src/lib/payments/oxygen/eligibility.ts` — Zod v4 exact-shape
  match for affirmative (`successful`/`eligible` literals + finite positive
  `eligible_amount`) and pending (`status` 400 + `response_code` "99"); else `unknown`.
- GREEN: 11/11 passed.

## Cycle 2 — eligibility fail-closed edges (tests pin behaviour, no change needed)

- Requirement: negatives, contradictions, bad limits, non-sample 400s → `unknown`;
  extra provider fields tolerated on documented shapes.
- Test first: extended the same file to 22 tests.
- Command: same as cycle 1.
- Outcome: 22/22 passed on first run — cycle-1 implementation already covered the
  edges. No RED, no implementation change; tests retained as regression coverage.
  This is not claimed as RED → GREEN evidence.

## Cycle 3 — exact NGN minor-unit conversion (historical setup failure → GREEN)

- Requirement: exact major↔minor conversion; reject excess precision, non-NGN, and
  unsafe magnitudes (plan fifth-review money cases, Baci-boundary side only).
- Test first: `apps/web/src/lib/payments/oxygen/money.test.ts` (26 tests).
- Command: `cd apps/web && pnpm vitest run src/lib/payments/oxygen/money.test.ts`
- RED: suite failed — `./money` unresolvable, 0 tests ran. This is a module-resolution failure, not the required behavioural RED.
- Change: new `apps/web/src/lib/payments/oxygen/money.ts` — decimal-string parsing
  with BigInt scaling, NGN-only guard, safe-integer bounds; provider-amount conversion
  deliberately absent (blocked on CR-06).
- GREEN: 26/26 passed after fixing a stray quote in the regex literal (parse error on
  first GREEN attempt, fixed before any pass was recorded).

## Refactor + affected coverage

- `pnpm biome check --write src/lib/payments/oxygen/`: fixed 2 formatting diffs.
- `pnpm vitest run src/lib/payments/oxygen/`: 2 files, 48/48 passed.
- Package checks: `pnpm turbo lint typecheck --filter=@baci/web` (see final report).
- No existing test was modified; no unrelated failure was touched.


## Review correction — 6 October 2026

Cycles 1 and 3 do not establish the handover's required behavioural RED: no test
assertion executed. Historical test-first compliance cannot be recovered retroactively.
Cycle 2 remains honest additional passing coverage. The skill-availability statement
above is the prior agent's report, not a current filesystem conclusion.

Independent baseline rerun: `pnpm vitest run src/lib/payments/oxygen/` from apps/web:
48/48 passed. Review nevertheless found two defects:

- Contradictory affirmative/error or pending/decision fields were stripped by permissive
  schemas, permitting an eligible/pending result instead of unknown.
- `Number.MAX_SAFE_INTEGER / 100` returned `90071992547409.9`, losing one kobo.

### Actual behavioural RED → GREEN for the fixes

Command from worktree root:
`pnpm --filter @baci/web exec vitest run src/lib/payments/oxygen/`

RED before implementation edits: 55 tests executed; 11 failed, 44 passed. Six new
contradiction cases returned eligible/pending instead of unknown. One new maximum-money
case returned a rounded number; four existing assertions were updated for the deliberately
changed exact decimal-string output contract and also failed. This is not a claim of
11 newly discovered defects.

GREEN after fixes: 55/55 passed. Schemas now live in the app schema directory and reject
conflicting decision/error fields. Major-unit output is canonical two-decimal text using
BigInt quotient/remainder; it round-trips the maximum safe minor integer. No production
callers existed for either helper, verified by source search. Eligibility remains an
unwired body-sample classifier, not verified credit approval or an HTTP transport adapter.

The validation guide referenced by the first agent is absent in this worktree. This
review used the user's supplied validation instructions and the primary checkout's
`docs/agent-guidance/validation.md` for isolated web checks. No instruction files were
synchronised or unrelated files changed. Final verification is recorded in REVIEW-2026-10-06.md.


### Automated-review follow-up RED → GREEN

CodeRabbit completed review of 11 files with one major finding: the opposite sample's
`message` or `response` field could still be stripped. Added two mixed-body tests first;
57 tests executed, 2 failed and 55 passed. Added explicit forbidden-field guards without
parsing human-readable wording. Final run: 57/57 passed. Web lint and typecheck were
rerun after this runtime edit. The review preceded this fix; no second clean review is
claimed.

## Slice S-02 — login transport + token cache (6 October 2026)

Requirement source: `S02-DESIGN.md` v2 (APPROVED pre-coding after a REJECT with 12
required amendments, all closed and re-verified), `CONTRACT-REGISTER.md` CR-02
(documented login sample only), `RESEARCH-2026-10-06.md` patterns R-01…R-10.
Implemented by a bounded implementation agent on a disjoint six-file set; the
per-module RED/GREEN below is the agent's report, and the orchestrator verified
the final state by reading all six files and rerunning every gate. No provider
calls; synthetic fixtures only.

All implementer runs from worktree root via
`pnpm --filter @baci/web exec vitest run <file>`.

### Schema (`apps/web/src/schemas/oxygen-login.ts`)

- Tests first (16 tests), then a compiling stub with loose `z.string()` /
  `z.number()` shapes. RED: 16 executed, 5 failed / 11 passed — `rejects empty
  token`, `rejects zero/negative/fractional/huge expires_in` (stub accepted
  them). All genuine assertion failures.
- GREEN: 16/16 after `token: z.string().min(1)`,
  `expires_in: z.number().int().min(1).max(86_400)`.

### Transport (`apps/web/src/lib/payments/oxygen/transport.ts`)

- Tests first (38 tests), then a stub that always threw `upstream_error`. RED:
  38 executed, 37 failed / 1 passed (only the static `server-only` first-line
  test passed — setup proven, all behavioral assertions failed).
- GREEN: 38/38. One real defect found during GREEN: a genuine
  `DOMException(…, 'AbortError')` initially mapped to `network_error` instead
  of `timeout` (shared `isAbortError` requires `instanceof Error`, which misses
  jsdom-realm DOMExceptions). Fixed with a dual check reusing the shared helper
  plus an explicit DOMException branch; verified against shared source by the
  orchestrator.

### Cache (`apps/web/src/lib/payments/oxygen/token-cache.ts`)

- Tests first (26 tests), then a stub (`getToken` always threw, `invalidate`
  no-op). RED: 26 executed, 24 failed / 2 passed (marker test + vacuous
  absent-key idempotence).
- GREEN: 26/26.
- Two iterations for `tsc` (TS2454 self-referencing singleflight closure →
  explicit deferred) and Biome (`noEmptyBlockStatements` → definite-assignment
  declarations); tests re-run green after each.

### Orchestrator hardening round (findings H1–H3, H5–H7; firsthand)

(H-labels are hardening findings from the S-02 diff review; F1–F7 remain the
later-slice follow-ups in `S02-DESIGN.md`.) The final-snapshot diff review
returned ACCEPT-WITH-FOLLOWUPS (zero must-fix). The orchestrator addressed the
valid hardening items with behavioral TDD:

- H2/H3 transport input hardening: added 10 tests (query/fragment/userinfo
  baseUrl; null/undefined/non-object input; null/missing `fetchImpl`;
  non-function `now`). RED: 48 executed, 8 failed / 40 passed — H3 URLs were
  accepted, null/undefined input threw raw TypeErrors, bad deps misclassified.
  (String/number inputs passed immediately — already fail-closed; recorded as
  pins, not RED.) Fix: `?`/`#`/userinfo rejection, pre-destructure seam
  validation. GREEN: 48/48.
- H6/H7 cache hardening: added 5 tests (per-awaiter copies; NaN/-1/Infinity/
  string skew rejected at construction). RED: 31 executed, 5 failed / 26
  passed. Fix: `.then` copies for joiners + copied creator result;
  construction-time skew validation. GREEN: 31/31.
- Pins (passed immediately, recorded as pins, not RED): H1 redirect-rejection
  → `network_error` mapping test; H4 ±Infinity `expires_in` schema rejections;
  H5 `info`/`warn`/`debug` console spies + `invalid_key` key-echo sweep.
- Deferred with reason: H4 whitespace-only token (literal design compliance,
  zero impact, fails closed downstream at the provider). See `S02-DESIGN.md`.

### CodeRabbit finding: body read escaped the timeout (firsthand RED → GREEN)

CodeRabbit's S-02 snapshot review raised one major finding: the timer was
cleared when `fetchImpl` resolved, so a body read stalling after headers
would hang past `timeoutMs`. Verified valid against the code.

- Reproduced first with 2 tests: stalled body read (never-resolving `text()`
  + fake timers) and genuine `AbortError` from `text()`. RED: 51 executed, 2
  failed / 49 passed — the stall hung (`expected [] to have a length of 1`)
  and the abort misclassified (`invalid_response`, expected `timeout`).
- Fix: timer cleared once after body parsing; the 2xx read races the composed
  abort signal and rejects with a genuine AbortError DOMException mapped to
  `timeout`; parse-error mapping preserved. GREEN: 51/51. (One self-caused
  scoping slip during the fix broke 14 tests transiently; fixed before GREEN.)

### S-02 final verification (orchestrator-run)

- `vitest run src/lib/payments/oxygen/ src/schemas/oxygen-login.test.ts`:
  5 files, 158/158 passed (57 S-01 + 101 S-02, incl. the 2 timeout-read tests).
- `pnpm turbo lint typecheck --filter=@baci/web`: both pass (Biome clean).
- Unwired gate `grep -rlE 'oxygen/(transport|token-cache|login)'
  apps/web/src/app apps/web/src/components`: no matches (`rg` unavailable;
  equivalent grep used, disclosed).
- CodeRabbit re-review of the final snapshot + second delta critique: see
  `REVIEW-2026-10-06-S02.md`.
- S-02 modules are unwired decision/transport primitives with no routes,
  callers, or provider contact. "Implemented against mocks" is not
  "integration complete."

## Slice S-03 — default-off availability boundary (6 October 2026)

Requirement source: `S03-DESIGN.md` (orchestrator-drafted, self-critiqued;
inline implementation chosen over subagents for a ~120-line pure module —
see the design's proportionality note) and `INDEPENDENT-S02-REVIEW.md`
5-point availability contract. No provider calls; no new provider assumptions
(currency gating explicitly deferred on CR-06; guest decision injected, not
made). Implemented inline by the orchestrator; all runs below are firsthand
from worktree root via `pnpm --filter @baci/web exec vitest run <file>`.

- Tests first: `apps/web/src/lib/payments/oxygen/availability.test.ts`
  (35 tests: per-reason denials, multi-fault priority, guest flag branches,
  null/malformed config, truthy-non-boolean flags, recovery independence,
  log-safety sweep, console silence, no-import static test).
- Then a compiling stub returning `{ allowed: true }` from both decisions.
  RED: 35 executed, 29 failed / 6 passed — every denial, priority, and
  mismatch assertion failed genuinely; the 6 passes were the structural pins
  (no-import, console silence), the two allow-branches, and the echo sweep
  (vacuous on allow-only output).
- GREEN: implemented `apps/web/src/lib/payments/oxygen/availability.ts`
  (binding → environment → guest → rollout → readiness priority; separate
  binding-only recovery decision taking no rollout/readiness inputs).
  35/35 on the first implementation run; no test changed after RED.
- Refactor: none needed (minimal already); Biome `--write` fixed formatting
  in 1 file, tests re-run green.

Final verification (orchestrator-run): `vitest run
src/lib/payments/oxygen/ src/schemas/oxygen-login.test.ts` → 6 files,
203/203 passed (168 prior + 35 S-03). `turbo lint typecheck --filter=@baci/web`
pass. Extended unwired gate (transport|token-cache|login|availability|
eligibility over `src/app` + `src/components`): no matches. CodeRabbit
reviewed 25 files with 1 minor finding (token-cache `storedAtMs` anchoring),
rejected with reason: completion-anchored storage shortens effective lifetime
by one RTT (fail-closed); request-start anchoring would extend apparent
validity toward the boundary with no safety benefit, and the serve ceiling
is transport-anchored regardless of `storedAtMs`. No S-03 file drew a
finding. The boundary is unwired policy: no enforcement exists until the two
defined consumers are built.

## Slice S-05 — consumer Phase A routes (6 October 2026)

Requirement source: `S05-PLAN.md` v2 APPROVED (pre-coding REJECT with F1–F18,
all closed; checklist recheck REJECT on delta D1–D5, all closed; final
confirm APPROVE), corrected `S04-DESIGN.md`, live evidence in
`PRODUCTION-AUTH-CHECK-2026-10-06.md` (reconciled into the register; no
further live calls). Implemented by a bounded implementation agent on a
disjoint ten-file set; per-file RED/GREEN below is the agent's report, and
the orchestrator verified the final state by reading all sources, rerunning
every gate, and hardening the review follow-ups firsthand (below).
Synthetic fixtures only; no provider contact.

Implementer runs from `apps/web` via `pnpm vitest run <file>`:

- Schemas (`oxygen-requests.ts`): tests first (10), stub with `wrongKey`
  instead of `orderId`. RED: 10 failed / 10 (acceptance, strip-keys,
  `fieldErrors.orderId`). GREEN: 10/10.
- Context (`context.ts`): tests first (28), stub (always-deny resolve,
  always-customer prove). RED: 19 failed / 28 (all ok-path, query-shape,
  propagation, prove-matrix assertions). GREEN: 28/28.
- Initiation (`initiation.ts`): tests first (26), stub with swapped shapes.
  RED: 24 failed / 26. GREEN: 26/26.
- Attempts route: tests first (21), stub always-500. RED: 18 failed / 21.
  GREEN: 21/21.
- Availability route: tests first (21), stub always-500. RED: 18 failed / 21
  (incl. shared-decision disagreement with the real POST). GREEN: 21/21.
- Combined: 5 files, 106/106. Biome clean after format + one manual
  `useConsistentArrayType` fix; tsc zero errors in owned files (one
  `StaffRole` literal fixed); scope verified (ten `??` files, zero modified).

### Orchestrator hardening round (diff-review follow-ups; firsthand)

Final-snapshot diff review: ACCEPT-WITH-FOLLOWUPS (zero must-fix). The
orchestrator adjudicated its own four candidates through the reviewer ((a)
valid-minor, (b)/(c) invalid with reasoning, (d) valid-minor) and fixed:

- (a) customers outage masked as 404: added 3 tests (terminal maybeSingle,
  error propagation, zero-rows deny) + route 500 test. RED: terminal +
  propagation failed; zero-rows passed as pin. Fix: `.single()` →
  `.maybeSingle()` + throw on error; aligned 9 `'no rows'` fixtures to
  maybeSingle semantics (`{data:null,error:null}` — intent preserved, driver
  encoding changed; error handling now covered by the propagation tests).
  One availability fixture needed a second pass (different formatting).
  GREEN: full suite.
- (d) CSRF `as NextResponse` cast: added fallback tests on both routes. RED:
  both failed (route returned undefined → TypeError on `.status`, genuine
  contract violation). Fix: `?? NextResponse.json({ error: 'CSRF validation
  failed' }, { status: 403 })` per the customers precedent. GREEN.
- (F1) repo-wide wiring sweep test (owned file, walks `src/`, asserts every
  oxygen importer is an S-05 route or test). Passed immediately against the
  grep-verified ground truth (2 routes + 6 test files) — recorded as a guard
  pin, not RED. Plus a 429-order pin (CSRF uncalled on GET 429), also green.
- Rejected with reviewer agreement: (b) staffCtx re-check (helper scoping +
  S-03 backstop verified; no production failing scenario), (c) reason-union
  sync pin (call-site assignability + green tsc already pins it).

### S-05 final verification (orchestrator-run)

- `vitest run` over oxygen lib + both schema tests + both S-05 routes:
  315/315 passed (203 prior + 106 S-05 + 6 hardening).
- `pnpm turbo lint typecheck --filter=@baci/web`: both pass (Biome clean).
- Redefined wiring gate: sweep test green + manual grep confirming only the
  two routes import oxygen modules and no S-05 file imports
  transport/token-cache.
- CodeRabbit re-review of the final snapshot + hardening recheck: see
  `REVIEW-2026-10-06-S05.md`.
- Local-only evidence: all behavior above is mock-boundary tested. The live
  production pairing (login 200, banks 200/44) is recorded separately in
  `PRODUCTION-AUTH-CHECK-2026-10-06.md` and was NOT re-probed. No deployment,
  sandbox, or transaction claim.

## Slice S-04 — joint consumer design (design-only, 6 October 2026)

No code changed, no tests run for this slice: `S04-DESIGN.md` (initiation
route + method listing + trusted-context table + 403 messages + enforcement
tests specified) and `PROVIDER-QUESTIONS-DRAFT.md` (send-ready draft; the
user sends in the existing thread). Validation: doc consistency/link
read-through, `git diff --check`, and the doc gate below. Implementation is
gated on CR-14 minimum; no further helper is planned before answers arrive.


## Independent S-02 regression pass — 6 October 2026

Baseline rerun: 158/158 passed. Added four regression cases before production edits:
caller/adapter mutation of an in-flight key retained an expired completed flight (two
cases); login delivery at/after conservative token expiry returned an expired token
(two cases). Command: `pnpm --filter @baci/web exec vitest run
src/lib/payments/oxygen/ src/schemas/oxygen-login.test.ts`. RED: four assertion failures,
158 passes out of 162. GREEN: 162/162. Web lint/typecheck passed after the fixes.
See INDEPENDENT-S02-REVIEW.md for scope, review outcome and the next slice.


### Timeout configuration review follow-up

Fresh CodeRabbit review completed with one minor finding. Added six unsupported-delay
cases before changing runtime code: zero, negative, fractional, NaN, Infinity and
32-bit timer overflow. `pnpm --filter @baci/web exec vitest run
src/lib/payments/oxygen/transport.test.ts`: six assertion failures, 53 passes.
Node emitted timer-clamping warnings on the RED run. Added integer/range validation
before provider invocation. Final full Oxygen suite: 168/168 passed without those
warnings; web lint/typecheck rerun. No post-fix clean CodeRabbit verdict is claimed.


## Slice S-06 — checkout/chat interaction shell (6 October 2026)

One interaction contract shared by checkout and chat: framework-agnostic
core machine (`interaction.ts`), async hook glue
(`use-oxygen-interaction.ts`), props-driven renderer
(`OxygenInteractionPanel.tsx`), each with colocated tests. Unavailable and
sign-in states derive from the server response actually observed; handoff
requires a POST allow (dormant in Phase A — initiation still 503s);
interruption preserves context via a non-authoritative marker without
creating another attempt. No attempt IDs, persistence, loan states, terms,
or approvals are fabricated; chat adapter is future work (hygiene builders
only). Design `S06-DESIGN.md` v2 (pre-coding REJECT findings F1–F33
addressed; recheck APPROVE).

Implementer RED/GREEN (child-reported, GREEN re-verified by orchestrator):
core RED 158 run / 143 failed (assertion mismatches, no setup failures) →
158/158; hook RED 69 run / 60 failed (`expected 'idle' to be 'checking'`,
uncalled spies) → 69/69, then +7 gap tests → 76/76; panel RED 34 run / 19
failed (copy/buttons/spinner/idle/token) → 34/34. Owned total 268/268,
re-run green by the orchestrator before review.

Orchestrator-verified final state:
`pnpm --filter @baci/web exec vitest run src/lib/payments/oxygen/
src/components/payments/oxygen/ src/schemas/oxygen-login.test.ts
src/schemas/oxygen-requests.test.ts src/app/api/payments/oxygen/` →
593/593 passed (315 prior + 278 S-06: 158 core + 86 hook + 34 panel).
`pnpm turbo lint typecheck --filter=@baci/web` → both pass (Biome clean
after one `--write` for 2 auto-fixable format/import findings in the new
tests; suites re-run green). `git diff --check` clean. Scope: six new
files only (implementer) + orchestrator test/doc fixes in those files and
`S06-DESIGN.md`; zero modifications elsewhere. Unwired: no oxygen
references in checkout/components outside `payments/oxygen`; initiation
503 arm intact (`initiation.ts` deny/503-only).

Independent final-snapshot critique: REJECT with F1 (major) + F2–F4
(minor), all reproduced and fixed failing-test-first by the orchestrator:
- F1: throwing `onSecureFormRequest` wedged the shell in `initiating`.
  RED: new regression test failed with `expected 'initiating' to be
  'handed-off'`. Fix: try/finally — transition always applies, single
  fire, marker-before-callback preserved, host error surfaces (pinned via
  a captured unhandledRejection assertion). GREEN 77/77 hook.
- CodeRabbit minor (valid; worse than stated): D-05 sweep passed ambient
  `window.status` instead of loop `state`, so every chat output collapsed
  to the fallback. RED: new distinctness assertion failed (`expected 1 to
  be greater than 1`). Fix: `status: state` in both calls. GREEN 158/158.
- F3: analytics-shape test never touched the real sink. Fix: test now
  calls the real `captureClientEvent` (test-only import; source module
  still zero-import, statically pinned). No behavioral RED possible;
  negative control instead: swapped args fail `tsc` with TS2345 on this
  file (reverted). GREEN + `tsc --noEmit` clean.
- F4: six composition tests added (guest→auth flip mid-lookup;
  notify-during-initiating; dismiss from unavailable/signin-required;
  resubmit-after-503 handoff; order-clear mid-POST). All passed on
  current code (pinning accepted behavior); teeth proven by mutation —
  removing both submit guards fails the order-clear test (single-guard
  removal passes by design: specified double-guard). 83/83 hook.
- F2: fail-closed drift recorded as F-crit-1 rows in `S06-DESIGN.md`
  (unknown deny reason/code → failed, never bare unavailable); F1
  behavior recorded as F-crit-2.
- Recheck of the fix set: ACCEPT, no findings.
- CodeRabbit re-review then found one new minor (valid): synchronous
  throws from injected `lookup`/`submit`/`generateNonce` wedged the
  shell. RED: 3 new tests failed (throws propagated out of render/act).
  Fix: lookup/submit throws normalize into their rejection paths;
  nonce throw fails the unstarted attempt as a submit network failure
  (inflight cleared, both recoveries, retry posts with a fresh nonce).
  GREEN 86/86 hook; recorded as F-crit-3 in `S06-DESIGN.md`. Focused
  recheck: ACCEPT. Final CodeRabbit run on the final snapshot:
  0 findings.

Local-only evidence: all S-06 behavior is mock-boundary tested (injected
lookup/submit/storage/clock/nonce); no live provider calls were made for
this slice, and the production pairing evidence
(`PRODUCTION-AUTH-CHECK-2026-10-06.md`) was not re-probed. No deployment,
sandbox, transaction, or partner-message claim. The independent S-05
review was still pending at slice end — no findings had landed; the shell
consumes only the S-05 route shapes verified by reading.

## Independent S-06 fixes — 7 October 2026

Supersedes the earlier F1 callback-throw behavior: failed handoff is not success.
RED: four behavioral regressions failed before implementation; callback throw also
produced the expected pre-fix unhandled rejection. GREEN: 595/595 Oxygen tests,
14 files. Web affected lint and typecheck pass; git diff whitespace clean.
Permanent regressions cover no handoff/marker after unmount or loading, ready
suspension, new-order lookup after loading, and callback-error recheck without
another submit. Generation cleanup invalidates pending responses; loading idles.
Manual memoization removed using effect-only useEffectEvent synchronization with
explicit input dependencies and a module-level sign-in no-op. Prior loading
expectations were updated for the changed contract. No provider/network fixture
calls, persistence, deployment, merge, or UI wiring.
Final CodeRabbit uncommitted review: 0 issues across 47 files, including the
final runtime and tests. Evidence-only notes updated after review; no runtime
edits followed it. See INDEPENDENT-S05-S06-REVIEW.md.

## Wiring-gate timeout hardening — 10 October 2026

Baseline re-verification found the suite RED: 637/638, with the S-05
repo-wide wiring sweep (`restricts oxygen imports to the two S-05 routes
and test files`) failing on the 10 s test timeout rather than an
assertion. Machine load was 81 (parallel agent loops); a direct grep for
the same pattern confirmed zero wiring offenders, so the gate's assertion
was sound and only its time budget was not. Fix (test-only, assertion
unchanged): skip content reads for path-exempt files (routes + tests;
exemptions depend only on the path, so the offenders list is identical)
and allow 60 s for the walk. GREEN: file 24/24, then full affected scope
638/638 across 20 files (Oxygen suite + manual-tool tests); web
lint/typecheck pass; `git diff --check` clean; CodeRabbit uncommitted
review completed with 0 findings. No runtime change; no provider calls.
