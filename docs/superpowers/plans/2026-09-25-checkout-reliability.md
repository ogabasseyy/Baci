# Checkout reliability implementation

## Current status

PR #3499 was merged on 25 September 2026 as `a00fc7481a`. Its final
current-head CI, CodeRabbit and Codex review passed. The production deployment
failed in a pre-existing shipping migration, so merge is not evidence that the
fix is live. Task 3 continues in the
[payment orchestration follow-up](2026-09-25-checkout-payment-orchestration.md).
The checkpoint below records the earlier foundation work, not final release
verification.

## Goal

Make the OgaBassey web checkout easier to change safely, starting with browser
coverage and the live contact/delivery boundary, then isolating submission and
order API responsibilities without changing monetary or retry contracts.

## Architecture

Keep the existing Next.js page, cart, persisted form, payment handlers and RLS
contracts. Test the real checkout in a separate production-built Next test app
using the real storefront providers and styles, with deterministic network
responses. No test routes or fixture switches enter the customer application.
This harness proves browser UI behavior; real tenant routing, provider settlement
and database effects still require staging evidence.

## Tech stack and specification

Next.js 16, React 19, Tailwind 4, Vitest and Playwright (Chromium/WebKit).
Specification: the user-approved checkout assessment of 25 September 2026 and
the current AGENTS.md instructions supplied in this task.

## Global constraints

- Work only in `codex/checkout-reliability`; preserve the dirty source checkout.
- Reuse existing checkout helpers. Preserve canonical pricing, guest access,
  order reuse, provider cancellation and indeterminate-payment fences.
- New focused modules aim for 300 lines. Move tests by behavior, not line count.
- No production data mutations, environment-file edits, proxy edits or deployment.
- Stage task-owned files before CodeRabbit review so added files are included.
- Dependency/test infrastructure changes require monorepo validation.

## Task 1: Establish a browser regression gate

Own `apps/web/tests/checkout-browser`, `apps/web/playwright.config.ts`, the web
package scripts, lockfile and a dedicated GitHub workflow.

- [x] Build a separate Next test app importing the real checkout and storefront
  cart/merchant providers. Use fake public Supabase configuration only.
- [x] Intercept and reject unexpected API/provider traffic. Use fixtures for
  tax, shipping, auth, order creation and payment preparation.
- [x] Assert actual visible/clickable order controls at 390, 1023, 1024 and 1440px
  in Chromium and WebKit, including client navigation and a late hidden utility.
- [x] Add guest, authenticated-session and resumed-order cases; characterize
  duplicate submit, retry and persistence before moving submission logic.
- [x] Demonstrate the original hidden-utility regression fails in a browser,
  then restore the merged fix and pass the suite.

## Task 2: Consolidate the live contact and delivery views

Own checkout contact/delivery components, small validation helpers and focused
tests, plus their call sites in `checkout-page.tsx`.

- [x] Write failing accessibility tests against the actual checkout.
- [x] Integrate the existing ContactStep, preserving current visual/summary
  behavior; remove duplicate inline markup and validation.
- [x] Associate labels/errors, add autofill, focus invalid controls, and make
  collapsed content inert. Preserve checkout inputs across collapse/reload.
- [x] Extract delivery view into cohesive modules with explicit typed props.
- [x] Split relevant page tests into focused suites using shared fixtures.
- [x] Restore lint coverage for the extracted modules and focused suites; the
  legacy page, data-loader file and PaymentStep test remain excluded.

## Task 3: Isolate submission and recovery transitions

- [x] Extract typed order request construction without changing monetary fields.
- [x] Isolate resumed-order loading by identity, cancel stale requests, and reset
  missing identities without restarting on form hydration.

- [ ] Inventory and characterize existing provider and retry branches.
- [ ] Extract order submission/reuse and explicit processing transitions using
  existing helpers; keep provider-specific logic behind typed boundaries.
- [ ] Run focused success/error/cancellation/response-loss tests and browser gate.

## Task 4: Narrow order API boundaries

- [x] Reject malformed JSON with a safe 400 and a regression test.
- [ ] Extract request parsing, pricing/delivery, idempotent create and
  post-commit responsibilities into focused modules.
- [ ] Replace user-facing admin edges with narrowly authorized database
  interfaces, preserving guest behavior and verifying SQL in a disposable DB.

## Task 5: Review and release evidence

- [x] Run chosen lint/typecheck/unit/browser gates and inspect every result;
  record full-suite failures and focused reruns separately.
- [x] Run CodeRabbit uncommitted review and one fresh-context branch review;
  fix the validated findings and record the remaining lint debt.
- [x] Commit and open a reviewable PR with exact evidence and remaining external
  gates. Keep merge, deployment and production verification distinct.
- [x] Drive existing PR #3499 through the current-head review and CI loop;
  incorporate validated audit findings in this PR without opening more drafts.
- [ ] Exercise available provider sandbox/staging flows and reconcile outcomes;
  record unavailable credentials/environment or settlement evidence explicitly.

## Review focus

The browser harness must exercise production components and generated CSS,
never copied checkout markup. It must fail on hidden actions or unexpected
network calls. Check accessibility on the integrated page, retain failure and
retry semantics, and avoid weakening guest/RLS or payment verification guards.

## Delivery checkpoint: browser and UI foundation

This first reviewable change includes Tasks 1 and 2, order request construction
and cancellable resume loading from Task 3, and malformed JSON handling from
Task 4. The browser baseline uncovered and fixed a maximum-update-depth loop
when hydrating resumed orders. The 8,337-line page test was split without
removing any of its 91 test cases; new modules have restored lint coverage.

The remaining submission/provider orchestration and order API migration are
still open. They need focused implementation and verification: the API currently has several
admin reads/writes that cannot simply be replaced with normal clients because
guest requests rely on them. Removing those edges requires narrow database
contracts, disposable-database authorization tests, and staging replay/fulfillment
evidence. Existing local Supabase containers belong to savings/REDVAULT work;
this change does not repurpose them. No claim of complete modernization or
provider settlement verification is made by this checkpoint.

The follow-up [architecture and performance audit](2026-09-25-checkout-performance-audit.md)
records removal of an unused request, totals-race fixes, a static bundle baseline, prioritized
improvements and the remaining evidence needed. The user requested one agent
drive the existing PR through review; this is not a plan to open multiple draft
PRs for the current findings.

## Checkpoint verification and remaining gates

- Production fixture build and browser typecheck passed; Chromium/WebKit:
  26/26 passed. Original visibility failure was reproduced before restoring
  the merged responsive fix.
- Focused Vitest: 1,152/1,152 tests in 189 files passed, including every original
  page case. Subsequent station fixture type correction passed its two cases.
- Monorepo lint passed with warnings. Monorepo typecheck passed after the final
  affected-web rerun corrected a test fixture provider code.
- New-module/analytics authority contract: 13/13 passed after adding focused
  component tests and using recognized test-support filenames.
- CodeRabbit and one independent reviewer completed. Valid findings fixed:
  resume reset, hydration focus, fixture isolation, interval interception,
  workflow runner context, and unknown same-origin network requests.
- The initial full monorepo run passed all five other test tasks. Web reported
  35,753 passed and nine failed assertions across eight files. This run began
  before the review fixes; subsequent focused checks cover those final edits.
  Failures covered a stale CSS source assertion, resume-reset regression,
  required test colocation, a governed-path timeout, clean-checkout/dependency
  integrity preconditions, the order-route byte receipt, and frozen storefront
  inventory drift. The PR records final targeted reruns of these gates.
- The order-route content receipt was refreshed solely for the safe malformed
  JSON response before business-data access. Existing notification/payment
  authority and database operations are unchanged; no privileged exception is
  renewed by this receipt.
- The frozen storefront edge inventory remains bound to
  `2f4bd1441227a38807d660a3d75c531c47f4dc07`. Its explicit checkout-page input
  already differed at the pre-task base `00d2ff88eb` after #3497. This change also
  requires a refreshed inventory. The source-authority verifier and artifact
  have not been weakened or regenerated as part of this checkout refactor.
- Provider settlement, real sign-in, tenant routing and database RLS behavior
  remain unverified by the isolated browser fixture. No merge or deployment.
