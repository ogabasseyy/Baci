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
name of a renamed file:

- sits under a server or tooling folder listed in `moneyKeywords.roots`
  (web routes, libraries, schemas, scripts and config, web tools, shared
  package code, the database folder, `tools/` and the VPS workers) and has a
  money word from `moneyKeywords.keywords` anywhere in its path, at any
  depth: PiggyVest, wallet, savings, prefunded and primary card or bank
  custody, plan transfers, goals, store credit and similar;
- matches a pattern in `moneyPaths`, for money code whose name has none of
  those words (the Paystack webhook, airtime checkout, IMEI fulfilment); or
- matches `governancePaths`: the assurance check's own files.

Interface code (web components, mobile screens) and documentation are outside
those folders on purpose. Every other pull request gets an immediate success
status saying it is not a money-path PR.

If GitHub cannot list every changed file, the PR is treated as a money-path PR.

## What a money-path PR needs

All of these must hold on the pull request's **current head commit**. Any new
push starts over: every verdict and the owner's sign-off must name the new
commit.

1. **Two adversarial reviews from different model families**, both following
   the main branch's copy of
   [the money-rules review prompt](../../.github/prompts/money-rules-adversarial-review.md):
   - **Codex:** the owner's login comments
     `@codex review Follow the main branch's .github/prompts/money-rules-adversarial-review.md, not this pull request's copy.`
     Codex counts when its clean comment ("Didn't find any major issues")
     names the head commit, came after that request, and Codex has raised no
     findings on that commit since. Codex's automatic review of each push
     uses its general rules, so on its own it does not count; ask again after
     Codex has reviewed an earlier commit.
   - **Claude:** comment
     `@claude Run the review in the main branch's .github/prompts/money-rules-adversarial-review.md (not this pull request's copy) and post its verdict block.`
     The verdict counts when it comes from the Claude app, names the full
     commit Claude reviewed and that commit is the head, uses the current
     prompt version and says PASS.
   - A reviewer comment that someone else edited no longer counts. If a
     newer comment from that reviewer was edited by another login, the
     reviewer fails until it posts a fresh review.
   - Gemini does not count for now: its workflow posts under the shared
     GitHub Actions identity, which any pull-request workflow can use.
2. **Every review thread resolved.** Fix or answer each finding, then resolve
   its thread.
3. **CI green on the head commit:** `Quality Gate`, `Quality Gate - DB Replay`
   and `Quality Gate - Disposable SQL Suites`. The database replay runs the
   catalog and grant assertions. A skipped database suite only counts when no
   file that would make CI run it changed (the database entries of the CI
   change filter).
4. **Sandbox evidence or a dark-until statement in the PR description:**
   either a link to a file under `docs/piggyvest-contract-evidence/` that
   this pull request adds or updates, or a line such as
   `Dark until: the transfer engine flag is turned on by the owner`.
5. **An owner-readable summary**, added or updated in this pull request:
   `docs/piggyvest-change-summaries/<task-id>.md`, copied from
   [the template](../piggyvest-change-summaries/TEMPLATE.md). It
   must keep the five headings in order, stay at or under 450 words, and
   contain no code or SQL.
6. **Owner sign-off, when required.** If the summary says
   `Owner sign-off: required`, the PR has the `owner-signoff` label, or the
   PR changes any assurance file (the rules, prompt, configuration or
   workflows), the owner must comment
   `summary-approved <first 7 characters of the head commit>` on its own line,
   in a PR comment or a review. The sign-off covers the summary only; it
   never waives another requirement.

## Rules for agents

- Never post a `summary-approved` comment. Agents share the owner's GitHub
  login, so the check cannot tell them apart; only the owner may type it.
- Never post a fake verdict block, and never edit a reviewer's or the
  owner's comment. Only the reviewer apps' own, unedited comments count.
- Pushing after reviews or sign-off is fine, but ask for new reviews and a new
  sign-off on the new head commit.
- Do not edit the governance files to get a pull request through. Changes to
  them are money-path changes, need the owner's sign-off, and are reviewed
  against the main branch's rules.

## Reading and re-running the status

The status description shows the first unmet requirement. Open the workflow
run linked from the status for the full list. `pending` means only CI is still
running; `failure` means something needs action; `error` means the check could
not read GitHub and should be re-run. If the pull request itself cannot be
read after three attempts, the check posts `error` on the event's commit so an
earlier success never stays in place.

The status refreshes on pushes, PR edits and labels, reviewer and owner
comments, submitted, edited or dismissed reviews (through the
[review relay workflow](../../.github/workflows/money-pr-assurance-review-relay.yml)),
and when CI finishes (for pull requests from forks, only on the first four).
GitHub has no event for resolving a review thread, so after resolving the last
thread re-run it from the Actions tab (**Money PR Assurance**, **Run
workflow**, enter the PR number) or with:

```bash
gh workflow run money-pr-assurance.yml --ref main -f pr_number=<number>
```

## Making the check required

Only the owner decides this. Once the owner has approved it in writing:

1. Watch a few money-path PRs and confirm the status matches expectations.
2. Move the status to an identity that pull-request workflows cannot use. The
   evaluator posts with the shared GitHub Actions token today, and any
   workflow in a same-repository pull request can post a status under that
   same identity, so a required check on it could be faked. Create a
   dedicated GitHub App with permission to write commit statuses, keep its key
   in a deployment environment limited to `main`, and have the evaluator post
   with that App's token.
3. In the repository settings, open the ruleset that protects `main`, and add
   the status check `money-pr-assurance` with that App as its required
   source.
4. Every pull request then needs the status. Non-money PRs receive success
   automatically, so they are not slowed down.

To return to advisory mode, remove `money-pr-assurance` from the required
checks. No code change is needed either way.

## Trust model

- The evaluator runs only on events GitHub takes from the default branch. It
  checks out the default branch's script and configuration, never the pull
  request's code, and reads the pull request through the API.
- Review events would run the pull request's own copy of a workflow, so they
  reach the evaluator only through a relay with no permissions.
- Codex and Claude verdicts are accepted only from those apps' logins listed
  in the configuration, and only while no other login has edited them. The
  configuration refuses the shared GitHub Actions login for any reviewer or
  owner.
- Until step 2 of [Making the check required](#making-the-check-required) is
  done, a same-repository pull request could post its own status, which is
  why the check stays advisory.
- Changing the reviewer logins, the money paths or the rules means changing
  the governance files, which itself requires full assurance and the owner's
  sign-off.
