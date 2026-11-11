# Gemini PR reviewer

Workflow: `.github/workflows/gemini-code-review.yml`. Scripts: `.github/scripts/gemini-review/`.
Tests: `.github/scripts/gemini-review/*.test.mjs` and `.github/scripts/gemini-code-review-workflow.test.mjs`.

It sends one request per review to the Gemini API (no agent, no tools, no web access), posts the
answer as a pull request review, and sets the `Gemini review` commit status that Diff Guardian
tallies. Muse, Codex and CodeRabbit are separate reviewers and are not affected.

## The status

| State | Meaning | Job |
|---|---|---|
| `success` | Reviewed. No critical or high finding on a file the pull request changes. | green |
| `failure` | Reviewed. A critical or high finding on a changed file. Fix it, or add the `bypass-ai-gate` label. | red |
| `error` | Gemini could not review (quota, outage, bad key, unknown model, private repo). Not a vote either way. | green, with a warning |

`error` also covers two cases where a clean answer would prove nothing: the changed-file list is
empty or unreadable, or a changed file has control characters in its name (the model is never shown
such files). A real finding is still `failure` in the second case.

`error` is an abstention for Diff Guardian and for the job, but GitHub itself treats the `error`
state like a failure. So **never make `Gemini review` a required check** (a Gemini outage would then
block every merge). If an AI gate is ever wanted, require `Diff Guardian / quorum` instead.

`error` is on purpose. Before this rewrite a quota error turned the check red and counted as a
"Gemini found a problem" vote in Diff Guardian.

## Before turning it on (`gh workflow enable gemini-code-review.yml`)

1. **The `GEMINI_API_KEY` secret must belong to a project with billing linked (paid tier 1).**
   Probed on 2026-11-11: the current key is on Google's free tier, which allows about 5 requests a
   minute and a small number per day per model, so it cannot serve a day of pushes. Free-tier content
   is also "used to improve Google products"; paid-tier content is not.
2. Set a **Google Cloud budget alert** and, if you want a hard stop, a requests-per-day quota on the
   key's project. This workflow has no spending cap of its own.
3. **Private repositories:** nothing is sent to Gemini until the repository variable
   `GEMINI_PAID_TIER_CONFIRMED` is `true` (the status is `error` until then).
4. Optional: repository variable `GEMINI_MODEL` to change the model (default `gemini-3.6-flash`).

## What it costs

Measured on 2026-11-10: 255 pull request pushes a day, 23% of them merges from main (skipped here
because the pull request's own changes did not change), about 5% on draft pull requests. That is
about 186 paid reviews a day, about 5,650 a month.

Measured tokens per review: 21,700 to 28,300 input (the prompt is capped at 90 KB, about 28,000
tokens; three real prompts averaged 25,000) and 100 to 2,000 output (thinking tokens are billed as
output; averaged about 1,000 on `gemini-3.6-flash`, about 100 on the lite models, which do not think).

| Model | Per review | Per month | After 1 Jan 2027 | Note |
|---|---|---|---|---|
| `gemini-3.6-flash` (default) | about $0.022 | about $127 | about $254 | Best of the stable models; Google doubles its price on 2027-01-01 |
| `gemini-3.5-flash-lite` | about $0.008 | about $44 | same | Does not think; on a probe it approved a pull request with no findings |
| `gemini-3.1-flash-lite` | about $0.006 | about $36 | same | |
| `gemini-2.5-flash-lite` | about $0.0025 | about $14 | same | Oldest and weakest; served "until further notice" |

Sending only the diff (no full changed files) would cut the input by about 60%: roughly $62 a month
on `gemini-3.6-flash`, $17 on `gemini-3.5-flash-lite`. That would need a code change and loses the
full-file context that keeps the model from calling code "missing" that it simply could not see.

Prices: aistudio.google.com/docs/pricing on 2026-11-11. The estimate for each review is also printed
in the posted review and in the job summary.

## Skipping rules (no model call, no cost)

The `decide` step skips the model when the `bypass-ai-gate` label is set, the repository is private
and unconfirmed, this exact commit was already reviewed, or the new commit is a **merge commit** (main
merged in) and the pull request's own added and removed lines are identical to those of the last
review (fingerprint in the hidden first line of the review). Normal commits are always reviewed:
identical changed lines can still mean the same lines moved somewhere else. A skipped push still
gets a status: the earlier result is carried to the new commit. A manual `@gemini-cli /review`
comment skips these shortcuts and always asks the model again, but the `bypass-ai-gate` label and the
private-repository guard still apply to it.

## Where to change things

- Review rules sent to the model: `.github/scripts/gemini-review/contract.md`.
- Request shape, retries and error classes: `api.mjs` (a model that rejects the thinking setting is
  asked again once without it, so `GEMINI_MODEL` can be any Gemini model). Review parsing and rendering: `review.mjs`.
- Posted text is scrubbed (`sanitize.mjs`): no @mentions, images, HTML comments or secret shapes, and
  links are turned into code so nothing the model writes is clickable. A status write that fails is
  retried once and then only warned about (a lost write is an infrastructure miss, not a finding).
- The scripts run from the default branch, so a change takes effect after it is merged.
