# H1 implementation/prep progress

- Plan: `docs/superpowers/plans/2026-08-15-ogabassey-home-h1-implementation-prep.md`
- Frozen base: `bcdbf54cb591af2d9047afacaf75cdaaa29cccfa`
- Boundary: inert implementation preparation only; activation and performance claims remain blocked by the documented H0/H0R gates.

## Task 0 — prep contract

- Implementation commit: `be3b0efcfcf13e675a66f754d36d7a09c2d97a76`
- Review: spec pass; quality pass with minor wording/count concerns.
- Documentation correction: the normative V4 contract/index is restored and
  unchanged at `3503ca9613b6a511b2e37fb3d35b48830d19e8559e7e3c5df136487fce9efdca`;
  the prep document is a non-normative owner-authorized note with no phase-index
  row. The current note is 110 lines.

## Tasks 1–2 — hero identity and preload projection

- Implementation commit: `98cda1ce9e`
- Initial review: blocked on malformed shell, merchant identity, foreign CDN, and null-preload validation.
- Fix round 1/5: `1df850a3f1`
- Scoped re-review: spec clean; quality clean; exact regressions present.
- Fix round 2/5: `de11d3592a`
- Scoped re-review: clean; test fixture now narrows the published-shell union without weakening runtime types.
- Whole-branch review fixes: `a40c72b87d`
- Final exact-code-head review: `f8c59e246a` — CLEAN for code, plan, boundary, and tests. CodeRabbit final review reported 0 findings; this review does not claim the docs commit was reviewed.

## Task 3 — integration and release gates

- Focused tests: 4 files and 70 tests passed on the final validation run.
- Full branch lint: passed with pre-existing warnings only.
- Full branch typecheck: passed (6/6 tasks).
- Full monorepo test attempt: 28,847 web tests passed; two unrelated validation tests failed because the sparse worktree omitted `scripts/` and `scripts-tmp/`, and because the then-untracked ledger made a clean-worktree guard refuse execution.
- Validation-environment reconciliation: the missing tracked paths were added to the sparse checkout and this ledger was committed. Exact reruns then passed: `verify-event-pipeline-boundaries.live.test.ts` 1/1 and `cloudflare-evidence-process-isolation.test.ts` 1/1.
- Frozen-input reconciliation: the recorded base and contract remain unchanged in this ledger; no re-freeze was requested.
- Current prep note length is 110 lines; it remains outside the normative phase index.
