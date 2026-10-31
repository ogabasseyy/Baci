# Money PR assurance runbook

The `money-pr-assurance` commit status tells the owner whether a pull request
that changes how money moves has had the extra checks the PiggyVest program
requires. It is posted by
[the Money PR Assurance workflow](../../.github/workflows/money-pr-assurance.yml)
using [its configuration](../../.github/money-path-paths.json).

The check is **advisory** until the owner explicitly makes it required (see
[Making the check required](#making-the-check-required)). It does not change
or replace any existing gate: CI, Codex approval, CodeRabbit, Jules and the
review-thread rule all still apply.

## Which pull requests it covers

A pull request is a money-path PR when any changed file, including the old
name of a renamed file, matches a pattern in `moneyPaths` or
`governancePaths` in the configuration. That covers PiggyVest, wallet and
savings server code, their database migrations, SQL suites and replay
registrations, and the assurance check's own files. Every other pull request
gets an immediate success status saying it is not a money-path PR.

If GitHub cannot list every changed file, the PR is treated as a money-path PR.

## What a money-path PR needs

All of these must hold on the pull request's **current head commit**. Any new
push starts over: every verdict and the owner's sign-off must name the new
commit.

1. **Two adversarial reviews from different model families**, both following
   [the money-rules review prompt](../../.github/prompts/money-rules-adversarial-review.md):
   - **Codex:** comment `@codex review Follow .github/prompts/money-rules-adversarial-review.md`.
     Codex counts when its clean comment ("Didn't find any major issues")
     names the head commit and it has raised no findings on that commit since.
   - **Claude or Gemini:** for Claude, comment
     `@claude Run the review in .github/prompts/money-rules-adversarial-review.md on this pull request's current head and post its verdict block.`
     The verdict counts when it comes from the Claude app, names the full head
     commit, uses the current prompt version and says PASS. A Gemini verdict
     counts the same way when it is posted by the Gemini review workflow with
     its head-commit marker; today that workflow uses its general review
     contract, so use Claude until Gemini is taught the money-rules prompt.
2. **Every review thread resolved.** Fix or answer each finding, then resolve
   its thread.
3. **CI green on the head commit:** `Quality Gate`, `Quality Gate - DB Replay`
   and `Quality Gate - Disposable SQL Suites`. The database replay runs the
   catalog and grant assertions. A skipped database suite only counts when no
   database file changed.
4. **Sandbox evidence or a dark-until statement in the PR description:**
   either a link to a file under `docs/piggyvest-contract-evidence/` that
   exists on the head commit, or a line such as
   `Dark until: the transfer engine flag is turned on by the owner`.
5. **An owner-readable summary**, added or updated in this pull request:
   `docs/piggyvest-change-summaries/<task-id>.md`, copied from
   [the template](../piggyvest-change-summaries/TEMPLATE.md). It
   must keep the five headings in order, stay at or under 450 words, and
   contain no code or SQL.
6. **Owner sign-off, when required.** If the summary says
   `Owner sign-off: required`, or the PR has the `owner-signoff` label, the
   owner must comment `summary-approved <first 7 characters of the head commit>`
   on its own line, in a PR comment or a review.
   The sign-off covers the summary only; it never waives another requirement.

## Rules for agents

- Never post a `summary-approved` comment. Agents share the owner's GitHub
  login, so the check cannot tell them apart; only the owner may type it.
- Never post a fake verdict block. Only the reviewer apps' own comments count.
- Pushing after reviews or sign-off is fine, but ask for new reviews and a new
  sign-off on the new head commit.
- Do not edit the governance files to get a pull request through. Changes to
  them are money-path changes and need the same assurance.

## Reading and re-running the status

The status description shows the first unmet requirement. Open the workflow
run linked from the status for the full list. `pending` means only CI is still
running; `failure` means something needs action; `error` means the check could
not read GitHub and should be re-run.

The status refreshes on pushes, PR edits and labels, reviewer and owner
comments, submitted reviews, and when CI or Gemini finishes (for pull requests
from forks, only on the first four). GitHub has no event for resolving a review
thread, so after resolving the last thread re-run it from the Actions tab (**Money PR Assurance**, **Run workflow**, enter the PR
number) or with:

```bash
gh workflow run money-pr-assurance.yml --ref main -f pr_number=<number>
```

## Making the check required

Only the owner decides this. Once the owner has approved it in writing:

1. Watch a few money-path PRs and confirm the status matches expectations.
2. In the repository settings, open the ruleset that protects `main`, and add
   the status check `money-pr-assurance` (source: GitHub Actions) to the
   required status checks.
3. Every pull request then needs the status. Non-money PRs receive success
   automatically, so they are not slowed down.

To return to advisory mode, remove `money-pr-assurance` from the required
checks. No code change is needed either way.

## Trust model

- The evaluator checks out the default branch's script and configuration,
  never the pull request's code, and reads the pull request through the API.
- Codex, Claude and Gemini verdicts are accepted only from those apps' logins
  listed in the configuration.
- Changing the reviewer logins, the money paths or the rules means changing
  the governance files, which itself requires full assurance.
