# Review-first CI (quick checks now, full CI after Codex says the commit is clean)

Owner decision, 2026-11-11. On 2026-11-10 there were 262 full CI runs (about 85 job-minutes each, 22,357
job-minutes) for 15 merged pull requests, because CI started on every push and every reviewer fix started another
full run. Review-first CI keeps the cheap checks on every push and starts the expensive suite only after the
required AI reviewer (OpenAI Codex) has said the exact current commit is clean.

Status: **built, off by default.** Merging the pull request changes nothing until the repository variable
`BACI_REVIEW_FIRST_CI` is set (see "Switching it on").

## In plain language

1. You push to a pull request from this repository. The normal `CI Quality Gate` run starts and does only the
   quick checks: the change detector, lint, type check, the "misc" guard tests, the mobile admin guardrails and the
   silent-revert guard (about 17 job-minutes instead of about 85). `Semgrep SAST` is untouched and also runs at once.
2. In that first pass the two jobs that carry the required names, `Build` and `Quality Gate`, are **renamed**
   to `Build (deferred until Codex review)` and `Quality Gate (deferred until Codex review)`. GitHub therefore sees
   no check called `Build` or `Quality Gate` and shows "Expected - waiting for status to be reported". Merging and
   auto-merge stay blocked.
3. When Codex reports no major findings for that exact commit, a small helper workflow
   (`Review-first CI nudge`) re-runs the same pull-request run ("re-run all jobs"). In the second pass the
   `changes` job re-checks the Codex verdict itself, finds it clean, and lets the heavy jobs run (web test shards,
   mobile and shared tests, `Build`, DB replay, SQL suites, CWV runner contracts, and the checkout browser
   regression). The jobs get their real names, so the required checks appear and merging can proceed once they pass.

Pushes to `main`, `merge_group`, manual runs and pull requests from forks behave exactly as before (full CI, normal
names).

## Options considered

| Option | Verdict |
| --- | --- |
| Skip the heavy jobs with a job-level `if:` | Rejected. GitHub counts a skipped required job as passed, so `Build` and `Quality Gate` would be green before any review. |
| A separate heavy workflow started with `workflow_dispatch` on the branch | Works in principle, but a dispatched run is not a pull-request run: different event name (the test planner and lint scope change), no merge commit, and a comment in `ci.yml` says dispatched checks do not satisfy required pull-request checks. It also cannot be tried before the new file lands on `main`. |
| Gate the first job (`changes`) with a job-level `if:` (draft-first PR #4115) | Rejected. The base-owned capability-gate contract pins `changes` as unconditional. |
| **Same run, two passes (chosen)** | Identical event, merge commit, test planner and lint scope as today. The required names do not exist in pass one, so nothing can be skipped-green. The verdict is re-read inside the run, so a wrong or early nudge cannot start the heavy suite. |

## Why a required check cannot end up skipped-green

* In pass one the jobs `build` and `quality` have a name expression that evaluates to the "(deferred ...)" text
  unless the run is allowed to be full. Their job-level `if:` is the same condition, so they are skipped under the
  deferred name. A skipped job named "Build (deferred ...)" satisfies nothing; the required context `Build` has no
  check at all.
* The condition is: not a pull request, or a fork pull request, or `needs.changes.outputs.stage == 'full'`. If the
  `changes` job fails or the stage output is empty, the answer is "deferred": merge stays blocked and the failure is
  visible on the `changes` job.
* `.github/scripts/review-first-ci/ci-workflow-contract.test.mjs` evaluates these exact expressions for every event
  type, so a rename or a changed condition fails a test.

## What counts as "Codex is clean"

All of these must hold for the pull-request head commit (full 40-character SHA, read fresh from the API inside the
run):

* A Codex item for that exact commit: the issue comment from `chatgpt-codex-connector[bot]` that contains
  `<!-- codex-review-receipt:v1 -->`, "Didn't find any major issues" and `Reviewed commit:` with the commit (full or
  abbreviated), or the summary comment (`<!-- codex-pull-request-review-summary -->`) whose
  `codex-review-state:v1` JSON says `code_review` is `completed`, `has_any_findings: false` and `commit_sha` equal to
  the head.
* The newest Codex item for that commit is the clean one. Findings (a Codex review or inline thread marked
  `<!-- codex-code-review-finding:v1 -->` / P1-P2 badge, or a summary with findings) after it win. A review that is
  still running means "wait".
* A verdict for an **older** commit counts only when the pull request's net diff is provably unchanged: every file
  the pull request touches has the same status and the same blob SHA at the old and the new commit (this is the
  "sync merge from main" case). Anything else (a changed file, a failed lookup, more than 300 files) means "not
  clean".
* Formats have changed before. If Codex items exist but none is understood, or the API cannot be read, the run
  fails closed (quick checks only) and says so in a warning on the `changes` job and in the job summary.

## When the heavy stage starts anyway

* **Break-glass:** add the label `ci-now` to the pull request (or comment `/ci-now` as a maintainer). The next
  evaluation starts the full suite immediately. Agents may use it when Codex is down, rate limited, or when the
  author has answered a finding and wants CI to prove the fix. Without the helper workflow, re-run the latest run
  by hand: `gh run rerun <run-id>` after adding the label.
* **Timeout:** if there is no Codex verdict at all (nothing, "running", or a usage-limit message) 60 minutes after
  the push, the full suite starts and the job summary says why. A pull request with Codex findings never times out
  (someone must fix or override). Draft pull requests never time out.
* **Kill switch:** delete the variable `BACI_REVIEW_FIRST_CI` (or set it to anything but `on` / `pilot`). The next
  run of every pull request is a normal full run, no code change needed.

## Switching it on

The variable `BACI_REVIEW_FIRST_CI` (repository variable, Settings > Secrets and variables > Actions > Variables):

| Value | Behaviour |
| --- | --- |
| unset / anything else | Off. Every pull request runs full CI on every push, as today. |
| `pilot` | Only pull requests carrying the label `review-first-ci` use review-first CI. |
| `on` | Every pull request from this repository uses review-first CI. |

Suggested rollout: merge (inert), set `pilot`, run one real pull request with the label through the whole flow,
then set `on`.

## For agents

Push, then wait. Do not start CI by hand and do not re-run jobs yourself. Codex reviews the new commit
automatically; when it is clean the full suite starts on its own and the required checks appear. Use
`ci-now` only when Codex is unavailable or you have a recorded reason, and say so in the pull-request thread.
Never arm auto-merge to "wait for Codex": the required checks do not exist before Codex is clean, but a timeout
or `ci-now` run can make them green without a Codex verdict.

## Files

* `.github/workflows/ci.yml`: `changes` resolves the stage; heavy jobs are gated on it; `build` and `quality` carry
  the dynamic names.
* `.github/workflows/checkout-browser.yml`: the browser regression follows the same stage.
* `.github/workflows/review-first-ci-nudge.yml`: re-runs the pull-request run when the verdict, the label or the
  timeout makes the stage "full". Base-owned: it runs from `main` and never checks out pull-request code.
* `.github/scripts/review-first-ci/`: the logic and its tests.

## Measuring it

See "Measurement plan" at the end of this file (filled in with the before snapshot and the after procedure).
