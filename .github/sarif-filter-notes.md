# SARIF filter trust notes

Why the `security.yml` Semgrep job invokes the drift auditor the way it
does (extracted from the workflow to honor the 300-line ceiling; the
invocation itself is unchanged).

The filter repairs the nosemgrep/SARIF transport gap for exactly one
audited finding after a fail-closed drift audit; any drift keeps the SARIF
unfiltered and fails the job, even with no SARIF (empty scans must not skip
the audit). `TRUSTED_CHANGED` carries the scope job's trusted-set diff
signal (same-repo PRs only; forks skip this job). Auditor logic lives in
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
at the head copy before the base auditor runs. The backstop is human:
`.github/CODEOWNERS` auto-requests `@ogabasseyy` on any `.github/**` diff,
so weakening the ~15-line invocation is a loud diff to the owner — but
full enforcement (require code-owner review, required SAST/selftest
checks) is a repo-settings step for the owner post-merge, while the
~5k-line auditor (unreviewable per-PR) stays base-pinned. A base-owned
`pull_request_target` gate would close even the loud vector; tracked
post-merge.
