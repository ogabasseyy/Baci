# Review-first CI (AI reviews and safeguards on drafts, validation once ready)

Owner decision, 2026-11-12: avoid validation CI during repeated AI review/fix rounds. Codex and Muse review drafts; agents mark ready only after both are clean on the current head and base. Main CI then runs validation for the first time, rather than repeating lint/typecheck/tests already run during draft review.

The main-CI gate applies to same-repository PRs selected by `BACI_REVIEW_FIRST_CI` (`on`, or `pilot` with the `review-first-ci` label). Forks and unselected PRs retain their existing main-CI behavior. Semgrep defers on all draft PRs independently of that switch; its existing fork/changed-path restrictions still apply when ready. Pushes to main, merge groups and manual validation keep their existing behavior. Scheduled security scans remain enabled.

## In plain language

1. Draft pushes run AI reviews and essential safeguards: the unconditional `changes` job (capability checks, workflow contracts and change detection), the silent-revert guard, secret scanning, and independent workflow guards. They do **not** run lint, typecheck, application tests, miscellaneous validation tests, mobile guardrails, builds, browser regression or Semgrep. Small local checks remain the agent's responsibility. The review-first CI self-tests, migration guards and iOS patch tests inside `quality-misc` deliberately wait for full validation too; the separate base-owned Capability Gate Contract remains active on draft pushes. Agents changing this CI policy run its focused tests locally before pushing. This trades later CI self-test feedback for fewer draft minutes; it does not disable those tests before merge.
2. Deferred `Build`, `Quality Gate`, and `Semgrep SAST` use different check names, so skipped draft jobs cannot turn the required contexts green. Draft status itself also prevents merging.
3. After both reviewers are clean, mark ready. `Review-first CI nudge` releases the existing PR-context CI and browser runs through the Codex gate. These validation jobs did not execute in the draft pass: only the small safeguards repeat. `Security` listens directly to `ready_for_review` and runs the applicable Semgrep scan. This is not a promise of zero Actions minutes during drafting.
4. If validation fails, fix the failure while draft, refresh affected review evidence and mark ready again. A changed commit needs its own CI evidence. Do not mark ready merely to trigger CI before the required reviews, or automatically rerun successful validation on the same head.

The helper remains necessary because the base-owned capability contract requires an unconditional `changes` job and forbids a `types` filter on the main CI trigger. Adding native `ready_for_review` there would fail that contract. Keeping the helper avoids weakening it and preserves required PR-context checks. Returning to draft does not guarantee cancellation of validation already running; the Security conversion event cancels its prior PR run, but the main CI gate controls future evaluations only. After a ready → draft → ready cycle, wait for the fresh ready-triggered Semgrep run; a cancelled earlier scan is not validation evidence.

## Options considered

| Option | Verdict |
| --- | --- |
| Skip the validation jobs with a job-level `if:` | Rejected. GitHub counts a skipped required job as passed, so `Build` and `Quality Gate` would be green before any review. |
| A separate heavy workflow started with `workflow_dispatch` on the branch | Works in principle, but a dispatched run is not a pull-request run: different event name (the test planner and lint scope change), no merge commit, and a comment in `ci.yml` says dispatched checks do not satisfy required pull-request checks. It also cannot be tried before the new file lands on `main`. |
| Gate the first job (`changes`) with a job-level `if:` (draft-first PR #4115) | Rejected. The base-owned capability-gate contract pins `changes` as unconditional. |
| **Same run, two passes (chosen)** | Identical event, merge commit, test planner and lint scope as today. The required names do not exist in pass one, so nothing can be skipped-green. The verdict is re-read inside the run, so a wrong or early nudge cannot start the validation suite. |

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
  binary or oversized patch, a failed lookup, 100 or more files) means "not clean".
* Formats have changed before. If Codex items exist but none is understood, or the API cannot be read, the run
  fails closed (safeguards only) and says so in a warning on the `changes` job and in the job summary.

## What counts as "Muse is clean"

Use the existing output contract in `.github/scripts/muse-review/post.sh`; a successful workflow alone is insufficient. Fetch all review pages (`gh api repos/ogabasseyy/Baci/pulls/<pr>/reviews --paginate`) and the live PR's `head.sha`, `base.ref` and `base.sha`.

- Require a submitted review from `github-actions[bot]` (`user.type == "Bot"`) whose `commit_id` equals the full current head SHA. Its body must start with `<!-- muse-code-review sha:<full-head-sha> base:<first-10-base-sha> -->` matching the live head and base.
- Verify the body’s `Workflow:` URL against the repository's actual `muse-code-review.yml` run: same PR, reviewed head and base in the event/evidence, and successful review execution and posting. The bot identity alone is insufficient because other workflows share it. Resolve the abbreviated base against that run's evidence, not against an assumed branch. If evidence cannot be verified, keep draft.
- Require the generated `## Findings` section to contain only `- No meaningful issues found.` and no inline or summary findings. Also read `## Verdict` and `## Suggested next steps`: contradictory findings, incomplete review, truncation, or unresolved actionable recommendations mean not clean. Reject `<!-- muse-fallback:v1 -->`, failed/skipped/no-output reviews, unknown formats, and quota messages. These checks pin the existing receipt; they do not introduce a new machine-enforced status.
- Use the newest applicable Muse review and inspect later reviews, inline findings and the linked workflow state. A later finding, fallback or in-flight review means wait; resolving threads on a findings review is not a new clean review. Paginate reviews and threads. Record the review ID, workflow URL, reviewed head, base branch and full base SHA in the review ledger.
- After a base retarget, obtain fresh Codex and Muse reviews even if the head SHA is unchanged. Do not infer Codex re-reviewed from a new Muse receipt: explicitly request Codex after the retarget and verify the new response targets that request and diff.

## When the heavy stage starts anyway

* **Break-glass:** add the label `ci-now` to the pull request (or comment `/ci-now` as a maintainer). On a ready PR, the next
  evaluation starts the full suite immediately; drafts remain safeguards-only. GitHub only lets people with triage or write access label a pull
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
  clean on the final head" stays a rule for agents and the owner, as it is today. Muse does not trigger heavy CI; agents verify its receipt using the checklist below before marking ready.
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

### Draft-first pull requests

<!-- draft-first-policy:start -->

Authoritative source: `.ruler/AGENTS.md`. Keep this marked policy block identical in all agent instructions and the runbook; `.github/scripts/review-first-ci/agent-policy.test.mjs` checks the copies in CI.

Owner decision, 2026-11-12: agents must create pull requests as drafts (`gh pr create --draft`). Keep fixes and review rounds in draft. For same-repository drafts, Codex and Muse automatically review new pushes; reuse current-head reviews or in-flight requests rather than posting duplicate requests.

Before running `gh pr ready <pr>`, verify that **both Codex and Muse** have completed a clean general code review for the exact current `headRefOid`, with no unresolved actionable findings or later contradictory review metadata. Verify reviewer identity and reviewed SHA; a green workflow alone, skipped/failed review, quota message, resolved old thread, or older-head verdict is not a clean review. Fix findings and push while still in draft, then wait for both reviewers again. If either reviewer is unavailable, keep the PR draft and report the blocker; only an explicit owner exception may waive this readiness rule.

Record the reviewed base branch and base commit as well as the head. A base retarget can change the diff without changing `headRefOid`: return to draft and explicitly request a fresh `@codex review` after retargeting (the draft Codex workflow does not automatically handle base edits). Wait for a new Codex receipt after that request and a fresh Muse review for the new base; do not reuse a same-head receipt from the old base. Any base identity change invalidates readiness evidence. Pin Muse provenance, head/base identity and clean wording using the “What counts as Muse is clean” checklist in `docs/runbooks/review-first-ci.md`.

Fork PRs follow the same review requirements, but these secret-bearing automatic reviewers do not run on forks. Report that limitation promptly and keep the PR draft while the owner arranges a trusted same-repository review branch or records a specific reviewer exception. If draft conversion is unavailable, report it promptly, keep auto-merge disabled and do not merge or claim review readiness; request an owner-approved review path. Reviewer outages follow the same escalation path. Never silently waive a reviewer, wait indefinitely without reporting the blocker, or expose secrets to fork code.

If another code change or base sync is needed after marking ready, convert back to draft (`gh pr ready <pr> --undo`) **before pushing**, so both draft reviewers run again. Recheck both reviewers on the new head. Keep explicitly paused or deprioritized PRs draft until the owner resumes them, even when reviews are clean.

“Ready” means ready for review and required CI, not permission to merge. Merge only when authorized by the user, both reviewers are clean on the final head, all required checks pass, and actionable conversations are resolved. Until a required GitHub check enforces both reviews on the exact head, do not arm auto-merge; disable any existing auto-merge (`gh pr merge <pr> --disable-auto`) before changing the PR, and use `gh pr merge <pr> --squash --match-head-commit <reviewed-sha>` for an authorized merge to reject a changed head. This is an agent policy: Muse is not currently a required GitHub status check. For same-repository PRs selected by review-first CI (`on`, or `pilot` with the `review-first-ci` label), drafts run AI reviews and essential workflow safeguards only, even when Codex is clean or `ci-now` is present. Lint, typecheck, application tests, miscellaneous tests, mobile guardrails and builds wait for the full stage. Semgrep also waits until ready; secret scanning remains active. Fork PRs and PRs outside that selection retain their existing main-CI behavior, including while draft (Semgrep draft deferral applies independently); the agent draft/readiness policy still applies to them. Marking ready releases validation through the existing Codex gate; the helper repeats only the small safeguards because validation has not run during draft review; agents must verify both reviewers first. Muse remains an agent readiness requirement, not a machine-enforced verdict gate. On ready PRs, `ci-now` and timeout recovery do not waive either review before merging.

<!-- draft-first-policy:end -->


Push, then wait. Do not start CI by hand and do not re-run jobs yourself. Codex reviews the new commit
automatically; once both reviewers are clean, mark ready and the full suite starts on its own and the required checks appear. Use
`ci-now` only when Codex is unavailable or you have a recorded reason, and say so in the pull-request thread.
Never arm auto-merge to "wait for Codex": the required checks do not exist before Codex is clean, but a timeout
or `ci-now` run can make them green without a Codex verdict.

## Files

* `.github/workflows/ci.yml`: `changes` resolves the stage; validation jobs are gated on it; `build` and `quality` carry
  the dynamic names.
* `.github/workflows/checkout-browser.yml`: the browser regression follows the same stage.
* `.github/workflows/review-first-ci-nudge.yml`: re-runs the pull-request run when the verdict, the label or the
  timeout makes the stage "full". Base-owned: it runs from `main` and never checks out pull-request code.
* `.github/scripts/review-first-ci/`: the logic and its tests.

## What you will see

* **While draft:** only AI review and safeguard jobs execute. Lint, typecheck, tests, mobile guardrails, builds and Semgrep are deferred. The required Build, Quality Gate and Semgrep SAST contexts are missing, not skipped-green; GitHub may display the raw expression for a skipped job's name.
* **After marking ready:** the main CI/browser run advances to its next attempt and validation runs for the first time. The Security workflow gets a new `ready_for_review` run for Semgrep. Required checks retain their original names.
* **Repeated work:** the main capability/workflow and silent-revert safeguards repeat in the released attempt; secret scanning also runs on the Security ready event. Validation was not run on draft pushes. Do not claim every Actions minute is eliminated or reuse a passing result across changed heads.

## Rehearsal evidence

Historical 2026-11-11 evidence below describes the earlier quick-checks-first design, before draft lint/typecheck/test/Semgrep deferral. It is not a measurement of the current safeguards-only draft stage.

Run on 2026-11-11 on a throwaway same-repository pull request, [#4205](https://github.com/ogabasseyy/Baci/pull/4205),
against the real branch protection, Codex and GitHub-hosted runners (switch `BACI_REVIEW_FIRST_CI=pilot`, removed
afterwards). A second throwaway pull request, [#4208](https://github.com/ogabasseyy/Baci/pull/4208), probed the default
token. The pull-request head moved many times; the SHAs below are the ones each run saw.

| What was shown | Result | Evidence |
| --- | --- | --- |
| Only quick checks before the verdict; `Build` and `Quality Gate` missing; merge blocked | Required contexts on the head: `Build` MISSING, `Quality Gate` MISSING, `Semgrep SAST` success. The deferred jobs appear as skipped entries named after their raw expression. Merge state `BEHIND`/`BLOCKED`. `changes` printed "waiting: Codex is still reviewing 3468bd4". | [run 43036029873](https://github.com/ogabasseyy/Baci/actions/runs/43036029873), [run 43038306932](https://github.com/ogabasseyy/Baci/actions/runs/43038306932) |
| Codex findings keep the heavy stage out | Codex reported findings on four heads in a row; every run stayed quick. | threads on #4205 |
| Heavy stage after a clean verdict on the exact SHA | Codex clean for `3af1379`. The run was re-run (attempt 4); its `changes` job re-read the verdict itself: "codex-clean: Codex reported no major issues for 3af1379". `Build` (real name) success, six web shards, mobile and shared tests, CWV contracts, lint and typecheck success. | [run 43044329612](https://github.com/ogabasseyy/Baci/actions/runs/43044329612) (attempt 4) |
| Fast path: Codex answers before CI starts | Head `a545a9c`: the first pass went full on its own, no re-run needed. The pull request's required checks showed `Build` success and `Quality Gate` produced under their real names. | [run 43057683694](https://github.com/ogabasseyy/Baci/actions/runs/43057683694) |
| A new push invalidates the verdict | Ten seconds after pushing a content change (`1cf40ec`) the real decision code answered "waiting: Codex's latest verdict is for a different commit (3af1379) and the pull request's diff changed since". | recorded decision, run [43056489436](https://github.com/ogabasseyy/Baci/actions/runs/43056489436) |
| A push that does not change the diff keeps it, with proof | A same-tree commit (`a545a9c`, what a rebase or a sync that touches none of the pull request's files produces): "carried: Codex reported no major issues for 1cf40ec; the net diff of a545a9c is identical". | recorded decision |
| Break-glass | With the label `ci-now` the decision is `full / break-glass` (warning) without reading Codex. A real run printed "break-glass: the \"ci-now\" label asks for the full CI now" in its `changes` job. | [run 43063500188](https://github.com/ogabasseyy/Baci/actions/runs/43063500188) |
| Timeout | With Codex stuck in "running": 20 minutes of waiting = quick; 40 minutes = "no Codex verdict after 40 minutes (limit 30): starting the full CI anyway". | recorded decision |
| Pushes to `main`, `merge_group` and manual runs unchanged | A manual run of the CI on the branch took the "full" path without running any new script: `Resolve CI stage (full CI)` ran, the other stage step was skipped, `Build` carries its real name, every heavy job started. | [run 43044363059](https://github.com/ogabasseyy/Baci/actions/runs/43044363059) |
| The default token can re-run a finished run | `POST /actions/runs/{id}/rerun` returned success and the run executed as attempt 2. | [run 43041337853](https://github.com/ogabasseyy/Baci/actions/runs/43041337853) |
| ...but cannot mark a pull request ready | `gh pr ready` with the workflow token: "Resource not accessible by integration (markPullRequestReadyForReview)". A user marking it ready did start the `ready_for_review` workflow. | [probe run 43042479997](https://github.com/ogabasseyy/Baci/actions/runs/43042479997), [control run 43042925141](https://github.com/ogabasseyy/Baci/actions/runs/43042925141) |
| Codex accepts a review request posted by the github-actions bot | The bot's `@codex review` comment got Codex's eyes reaction and a review summary for the head. | comment 6799071980 on #4208 |

What the rehearsal could **not** show, and why:

* The `Review-first CI nudge` workflow itself. Its triggers (a Codex comment, a label, a finished run, the schedule) run
  the copy on the default branch, so they cannot fire from a pull-request branch until the file is merged. The nudge
  code was run against the real pull request by hand (`nudge-cli.mjs`, which refused to re-run a failed quick run and
  would re-run a good one) and the re-run it requests was exercised by hand; the event wiring is covered by the
  contract tests and by the pilot step in the rollout.
* An all-green `Quality Gate` and a `CLEAN` merge state. From about 15:00 UTC the hosted runners could not resolve
  `azure.archive.ubuntu.com`, so the three jobs that install PostgreSQL (`Quality Gate - Misc`, `DB Replay`,
  `Disposable SQL Suites`) failed on unrelated pull requests as well as on this one. Everything else passed.
* A real push to `main` or a `merge_group` run (the merge queue is not enabled); the first real `main` run after
  merge, with the switch off, is the live proof.

Codex and Muse reviewed the rehearsal pull request itself and found real problems, each fixed with a regression test
that fails against the old code: a pilot-mode lookup failure that fell open, a sweep window shorter than the
timeout, the browser regression missed when CI was already full, a carry-over proof that ignored the base side of a
change, scripts that ran from the pull request's own checkout, a draft marked ready after hours that timed out
immediately, a pagination cap that returned a truncated history, a sweep that never visited old drafts marked ready,
and a 309-line test file.

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
4. Measure the safeguards-only draft stage and ready validation separately. The earlier 17–23 quick-stage job-minute estimate included lint/typecheck/misc jobs and no longer describes the draft stage. Include Security runs and AI review workflow costs in the overall comparison; the existing CI/browser measurement script alone does not count them. Do not publish a savings percentage until the new policy has representative live runs.
