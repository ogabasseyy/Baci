# Autonomous Error Remediation E2E Plan

## Goal

Make the VPS remediator reliably diagnose Codex failures, retain bounded incident
history by stable case/category, reopen recurring incidents with prior context,
and prove the complete candidate-to-draft-PR workflow without any automatic
merge, deploy, provider mutation, or direct write to `main`.

## Global constraints

- Work from an isolated branch based on current `origin/main`.
- Preserve the already-deployed Sentry evidence enrichment from PR #3304 so a
  later VPS deployment cannot silently revert it.
- Use test-first changes with captured RED and GREEN evidence.
- Keep all provider payloads bounded and scrubbed; never persist credentials,
  customer PII, or raw event bodies.
- Codex may edit only an isolated worktree. The outer worker may open a draft PR
  after verification, but may never merge, deploy, resolve Sentry, or mutate
  production.
- Treat `CODEX_HOME` warning cleanup separately from the actual current blocker:
  the mounted ChatGPT account has exhausted its Codex allowance.
- A case becomes `quiet` after seven days without a new observation. `quiet` is
  not the same as provider-resolved or production-verified.

## Task 1: Make Codex execution observable and canary-testable

**Files:**

- `vps-workers/lib/remediation-codex-command.mjs`
- `vps-workers/lib/remediation-codex-command.test.mjs`
- `vps-workers/lib/remediation-git-workflow.mjs`
- `vps-workers/lib/remediation-git-workflow.test.mjs`
- `vps-workers/lib/remediation-codex-output.mjs`
- `vps-workers/lib/remediation-codex-output.test.mjs`
- `vps-workers/jobs/remediation-codex-canary.mjs`
- `vps-workers/jobs/remediation-codex-canary.test.mjs`

Requirements:

1. Add failing regression tests showing a fatal line at the end of stderr/stdout
   is preserved in a bounded subprocess error rather than hidden by banner text.
2. Move container `CODEX_HOME` to an owned, writable tmpfs outside `/tmp` to
   remove the nonfatal helper warning.
3. Use Codex JSONL output and require a successful process plus terminal
   `turn.completed`; classify quota/auth/toolchain failures explicitly.
4. Add a read-only/no-change canary entry point using the same image, auth,
   UID, mounts, and command construction as remediation. It must create no
   worktree branch, commit, push, PR, or production mutation.

## Task 2: Add persistent bounded incident-case lifecycle

**Files:**

- `vps-workers/lib/remediation-case-state.mjs`
- `vps-workers/lib/remediation-case-state.test.mjs`
- `vps-workers/lib/remediation-worker.mjs`
- `vps-workers/lib/remediation-worker.test.mjs`
- `vps-workers/lib/remediation-policy.mjs`
- `vps-workers/lib/remediation-policy.test.mjs`
- `vps-workers/lib/vercel-error-events.mjs`
- `vps-workers/lib/vercel-error-events.test.mjs`
- `vps-workers/lib/sentry-error-events.mjs`
- `vps-workers/lib/sentry-error-events.test.mjs`

Requirements:

1. Persist versioned cases keyed by source, bounded category, and stable
   fingerprint. Retain first/last observed times, total observations, bounded
   representative samples, prior attempt outcomes, and draft PR linkage.
2. Reconcile observed cases before selection. Transition through `open`,
   `investigating`, `pr_open`, and `quiet`; do not label a patch as resolved.
3. Transition to `quiet` exactly after seven days without a newer observation;
   re-observation reopens the case and increments recurrence history.
4. Add category-aware fairness so one noisy category cannot consume the whole
   run. Provide only bounded, redacted prior case/category context to Codex.
5. Preserve provider identity as evidence: Sentry organization/project/issue
   identity stays attached, while category is not derived from mutable title
   alone. Vercel categories separate runtime exceptions, timeouts, and HTTP 5xx.

## Task 3: Integrate lifecycle reporting, deployment, and end-to-end proof

**Files:**

- `vps-workers/lib/remediation-pr-body.mjs`
- `vps-workers/lib/remediation-pr-body.test.mjs`
- `vps-workers/lib/remediation-report.mjs`
- `vps-workers/lib/remediation-report.test.mjs`
- `vps-workers/jobs/sentry-mobile-error-remediator.mjs`
- `vps-workers/jobs/vercel-error-remediator.mjs`
- `vps-workers/deploy.sh`
- `vps-workers/jobs/deploy-remediator-crontab.test.mjs`
- `vps-workers/REMEDIATION.md`
- `vps-workers/lib/remediation-e2e.test.mjs`

Requirements:

1. Reports and draft PRs expose safe case/category identity, recurrence count,
   prior outcomes, and lifecycle status without raw provider data.
2. Schedule the non-mutating canary and alert on toolchain/quota/auth failure.
3. Add a hermetic E2E test: fixture incident -> reconciliation -> Codex fixture
   edits isolated git worktree -> verification -> fake remote push -> fake draft
   PR -> persisted `pr_open` case. Assert no merge/deploy/provider mutation.
4. Add a recurrence E2E: the same case after `pr_open` with a newer observation
   reopens with prior PR/outcome context; seven quiet days transitions it to
   `quiet` and a later event reopens it.
5. Run worker tests, repo lint/typecheck/test, CodeRabbit, exact-head checks, and
   open a reviewable PR. Deploy to the VPS only after the PR merges, then run the
   live no-change canary and one controlled fixture rehearsal.
