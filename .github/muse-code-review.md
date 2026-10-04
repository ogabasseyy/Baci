# Muse Code PR reviewer (advisory only, never blocks merges)

Runs automatically on every same-repo pull request. It collects the PR diff,
runs `muse exec` headless with the repo checked out, and posts the result as
a PR review comment. Workflow: `.github/workflows/muse-code-review.yml`.

## Billing

Whatever credential is stored in the META_API_KEY secret. That can be the
subscription-linked key from `muse login` onboarding (flat monthly rate,
subject to plan prompt limits) or a pay-as-you-go Meta Model API key. The
workflow cannot tell the difference; verify billing on dev.meta.ai.

## Key hygiene

The agent holds this key with web tools on (see `run.sh` in
`.github/scripts/muse-review/`):

- minimum scope: a key that can only run model prompts, nothing else.
- rotation trigger: rotate immediately if any posted review looks tampered
  with, exfiltrated, or off-mission; treat odd output as compromise.
- spending cap: set plan/prompt limits or spend alerts on dev.meta.ai so one
  malicious same-repo PR cannot silently burn quota.

## Recency

Web tools are ON so every review verifies against current official docs
instead of training memory. The agent determines the repo's stack/versions
from manifests, checks for deprecated APIs and better modern alternatives,
and cites sources. A redaction step scrubs common secret patterns from the
review body before posting (defense in depth, since web access widens
prompt-injection exfil options).

## Quota safety

Subscription plans cap prompts per rolling window, so this workflow stays
cheap and advisory:

- concurrency cancel-in-progress: only the latest push per PR is reviewed
- bounded prompt (diff + repo guidance; the agent reads full files itself)
- --max-model-steps cap + job timeout
- never fails the build and never posts a commit status gate, EXCEPT the
  trusted-scripts resolver: a missing default-branch scripts checkout exits
  1 (fail closed) rather than silently running PR-controlled scripts with
  tokens. This workflow must stay out of required branch-protection checks
  so that red X degrades the advisory review without blocking merges.

Forks skipped by the job `if` (head repo check) — load-bearing under
pull_request_target, which WOULD expose secrets to forks otherwise.

## Layout

The workflow file only orchestrates steps; every shell program lives in
`.github/scripts/muse-review/` (each file under 300 lines per repo rules):

- lib.sh: shared pure helpers (redact, truncate, dedupe, neutralize)
- collect.sh: PR metadata, changed files, manifest, inter-phase vars
- diff.sh: unified diff + removed-lines supplement
- guidance.sh: repo guidance (trusted base first, head labeled UNTRUSTED)
- prompt.sh: prompt assembly + pre-run dedupe check
- guard.sh: pre-invocation head-freshness check (owns the GitHub token)
- install.sh: pinned Muse CLI install with SHA256 verification
- run.sh: headless agent invocation (no GitHub token in env)
- post.sh: staleness re-check, render, inline threads, post
- ranges.pl: diff-range extractor (JSON, escape-safe)
- clean.jq / validate.jq / dedupe.jq / fallback.jq: finding/dedupe filters
- schema.json: agent output contract
- test.sh: regression suite (runs in muse-review-selftest.yml)

## Prerequisites per repo

- Secret META_API_KEY (repo Settings -> Secrets and variables -> Actions)
- Optional repo variables: MUSE_MODEL, MUSE_REASONING_EFFORT
