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
  the pull request touches has the same status, the same final blob SHA **and the same hunks** (so a sync that changed
  main's side of a touched file, even if the final file is the same, does not pass) at the old and the new commit
  (this is the "sync merge from main" case; line-number shifts are ignored). Anything else (a changed file, a
  binary or oversized patch, a failed lookup, more than 300 files) means "not clean".
* Formats have changed before. If Codex items exist but none is understood, or the API cannot be read, the run
  fails closed (quick checks only) and says so in a warning on the `changes` job and in the job summary.

## When the heavy stage starts anyway

* **Break-glass:** add the label `ci-now` to the pull request (or comment `/ci-now` as a maintainer). The next
  evaluation starts the full suite immediately. GitHub only lets people with triage or write access label a pull
  request, and `/ci-now` is honoured only from the owner, members and collaborators. The label **stays until it is
  removed**: every later push of that pull request then runs the full CI at once (a warning shows on the `changes`
  job each time), so remove it when Codex is back. Agents may use it when Codex is down, rate limited, or when the
  author has answered a finding and wants CI to prove the fix. Without the helper workflow, re-run the latest run
  by hand: `gh run rerun <run-id>` after adding the label.
* **Timeout:** if there is no Codex verdict at all (nothing, "running", or a usage-limit message) **30 minutes**
  after the push, the full suite starts and the job summary says why. Why 30: Codex answered in 2 to 10 minutes on
  every pull request observed on 2026-11-11, so 30 leaves a wide margin without letting a Codex outage hold pull
  requests for an hour. It is one constant, `DEFAULT_TIMEOUT_MINUTES` in `stage-decision.mjs`; the repository
  variable `BACI_CODEX_WAIT_TIMEOUT_MINUTES` (whole minutes, at most 1440) overrides it without a code change. The
  nudge workflow sweeps every 15 minutes, so the full suite starts 32 to 47 minutes after the push in that case. A pull
  request with Codex findings never times out (someone must fix or override). Draft pull requests never time out, and
  a draft that is marked ready starts its 30 minutes at that moment, not at the push. **This is a deliberate bypass:**
  after the timeout the required checks can go green without a Codex verdict, so the rule "no merge before Codex is
  clean on the final head" stays a rule for agents and the owner, as it is today. Muse is advisory and does not start
  anything; if the owner wants a clean Muse review to shorten the wait, that needs Muse's verdict wording pinned first.
* **Kill switch:** delete the variable `BACI_REVIEW_FIRST_CI` (or set it to anything but `on` / `pilot`). The next
  run of every pull request is a normal full run, no code change needed.

## Who can change the gate

The decision code (`.github/scripts/review-first-ci/`) is **base-owned**: the `changes` job and the browser regression
run the copy that is on the base branch (`git archive` of the base commit), not the copy in the pull request. A pull
request that edits the scripts cannot change its own gate until the edit has been merged; only the pull request that
introduces the scripts runs its own copy (with a warning). Editing `ci.yml` itself is still possible in any pull
request, as for every other CI rule, and shows up as a workflow change for human review (trusted-change tripwire,
code owners). The `Review-first CI nudge` workflow is base-owned too. `changes` keeps its read-only permissions
and the capability-gate contract is untouched.

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

## What you will see

* **While waiting for Codex:** the pull request shows the quick checks plus `Semgrep SAST`. The two deferred jobs
  appear as skipped entries whose name is the raw name expression (GitHub does not evaluate the name of a skipped
  job). That is expected and harmless: no check is called exactly `Build` or `Quality Gate`, so the merge box says
  the required checks are missing. The `changes` job writes the reason for the stage into its summary and an
  annotation, and the nudge workflow keeps a `Review-first CI` commit status ("Quick checks passed. Codex is still
  reviewing ...").
* **After the re-run:** the same run shows attempt 2. The heavy jobs run, `Build` and `Quality Gate` appear under their
  real names, and the merge box behaves as before (strict, up to date, threads resolved).
* **Re-runs of quick jobs:** attempt 2 repeats the quick jobs (lint, typecheck, misc, guards), about 20 job-minutes per
  pull request. Skipping them when attempt 1 already passed them is a possible later optimisation.

## Measurement plan

Goal: hosted job-minutes per merged pull request, before and after, from the GitHub API (not from the billing page).

```bash
GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=ogabasseyy/Baci \
  node .github/scripts/review-first-ci/measure-ci-minutes.mjs --day 2026-11-10 --sample 60
```

It reads the `CI Quality Gate` and `Checkout browser regression` runs of one UTC day, bills every job that ran on a
GitHub-hosted runner rounded up to whole minutes (all attempts count; skipped and self-hosted jobs cost nothing),
splits the minutes into the quick and the heavy stage, scales a sample of runs to the day's run count and divides by
the pull requests merged that day.

| | Before (2026-11-10, no review-first CI) | After (fill in) |
| --- | --- | --- |
| Workflow runs (CI + browser) | 518 | |
| Quick-stage job-minutes | about 5,300 | |
| Heavy-stage job-minutes | about 14,000 | |
| Total hosted job-minutes | about 19,300 | |
| Merged pull requests | 15 | |
| **Job-minutes per merged pull request** | **about 1,285** | |

How to read the "after" column:

1. Switch to `on`, ignore the first day (open pull requests change mode mid-flight), then measure three ordinary
   days and compare the average.
2. Also record, from the `changes` job annotations (`title=Review-first CI`): how many stage decisions were
   `codex-clean`, `timeout`, `break-glass`, `codex-findings`, `api-error`. Many `timeout` or `api-error` entries mean the
   Codex integration or the token needs attention.
3. Median minutes from the push to the start of the heavy stage (Codex latency), and the number of pull requests
   that waited more than 90 minutes for it (should be close to zero because of the timeout).
4. Expectation to hold the change to: quick stage about 17-23 job-minutes per push, heavy stage about 85 plus the
   repeated quick jobs once per pull request that reaches a clean Codex verdict. With about 260 pushes and 35-40 heavy
   runs a day that is roughly 8,000-9,500 job-minutes a day: 2-2.5 times lower than before. The planner change in
   PR #4173, skipping the repeated quick jobs, and syncing pull requests only at merge time cut it further.
