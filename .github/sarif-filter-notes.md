# SARIF filter trust notes

Why the `security.yml` Semgrep job invokes the drift auditor the way it
does (extracted from the workflow to honor the 300-line ceiling; the
invocation itself is unchanged).

The filter repairs the nosemgrep/SARIF transport gap for exactly one
audited finding after a fail-closed drift audit; any drift keeps the SARIF
unfiltered and fails the job, even with no SARIF (empty scans must not skip
the audit) — except that `TRUSTED_CHANGE_ADVISORY=true` downgrades a
trusted-tree-only signal to a warning (exit 0, still filtered), because a
required job with no legitimate green path forces admin merges, a worse
outcome. The loud signal for that case moved to the separate
`semgrep-tripwire.yml` workflow, which is never required: it turns red
(and blocks nothing) on any trusted-set diff. `TRUSTED_CHANGED`
carries the scope job's trusted-set diff signal (same-repo PRs only;
forks skip this job). Auditor logic lives in
`.github/scripts/semgrep-sarif-filter.py` (+ `semgrep_sarif_*` modules),
pinned by `semgrep-sarif-filter.test.sh` (selftest).

PRs execute the BASE revision of that auditor (checked out by the
base-filter steps): the job workspace holds submitter-controlled head code,
so running the head copy would let a PR neuter its own audit. Push/schedule
runs use the workspace copy, which already is a trusted branch. No
fallback: a base without the auditor fails closed (bootstrap PRs stay red
by design).

Fork-PR gap (post-merge follow-up, not more `pull_request` YAML): forks
skip this job, so they need a base-side audit.

Invocation-ownership residual (accepted, post-merge follow-up): this
`pull_request` job's YAML is PR-revision code, so a same-repo PR could
delete this step, force the `TRUSTED_CHANGED` signal, or point `filter_dir`
at the head copy before the base auditor runs. The same residual covers
the tripwire workflow and the `TRUSTED_CHANGE_ADVISORY` env flag — all
PR-controlled signal, none of it enforcement. The backstop is human and
blocking: branch protection requires code-owner review (verified live
2026-10-14: `Main Branch Protection` ruleset active with
`require_code_owner_review: true`; re-verify before re-requiring SAST),
and `.github/CODEOWNERS` names `@ogabasseyy` on any `.github/**` diff, so
neutering the signal is a loud diff the owner must approve — but a
base-owned `pull_request_target` gate would close even the loud vector
(social-engineering the owner); tracked in issue #3622, while the
~5k-line auditor (unreviewable per-PR) stays base-pinned.
