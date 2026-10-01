#!/usr/bin/env python3
"""Drop one audited checkout finding from Semgrep SARIF output.

Semgrep honors nosemgrep for its exit code but still emits suppressed
findings into --sarif output with suppressions:[{kind:inSource}], and
GitHub code scanning ignores that flag -- the finding stays open as a
phantom alert. This filter repairs the transport for exactly one
audited finding (the reviewed pull_request_target checkout) after a
fail-closed drift audit of the hardening the exemption rests on.
Any drift keeps the SARIF unfiltered and fails the job.
"""
import json
import os
import posixpath
import sys
from types import SimpleNamespace
from semgrep_sarif_audit import (audit_pr_checkout,
                                 audit_trusted_checkout, find_pr_refs,
                                 load_workflow)
from semgrep_sarif_consumer import (audit_helpers,
                                    audit_invocations,
                                    audit_path_literals,
                                    audit_resolver,
                                    audit_run_hygiene,
                                    audit_script_dir)
from semgrep_sarif_helpers import audit_trusted_changed
from semgrep_sarif_pins import AUDITED_PATH, AUDITED_RULE_ID
from semgrep_sarif_runner import audit_agent_runner, audit_installer
from semgrep_sarif_steps import audit_agent_env, audit_step_commands

def main():
    drift = []
    # Resolve all file reads against the workspace root, not the
    # process CWD: a future working-directory default would
    # otherwise make the audit read the wrong tree (or report an
    # "empty scan" exit 0) instead of failing closed.
    root = os.environ.get("GITHUB_WORKSPACE") or os.getcwd()
    try:
        os.chdir(root)
    except OSError as exc:
        print(f"::error::Cannot enter workspace {root} ({exc}).")
        return 1
    code, workflow, raw = load_workflow(AUDITED_PATH)
    ctx = SimpleNamespace(code_lines=code, workflow_lines=workflow,
                          workflow_raw=raw, pr_refs=[], span=(0, 0),
                          trusted=[], resolve=[], joined=[])
    ctx.pr_refs = find_pr_refs(ctx)
    # The change signal gates even the no-checkout exit: a trusted-
    # tree edit that also removes the checkout still needs eyes.
    audit_trusted_changed(drift)
    if not ctx.pr_refs:
        # No PR-controlled checkout left to exempt (e.g. removed in
        # favor of API-fetched diffs): nothing to filter, and failing
        # here would punish the safest possible change — unless the
        # trusted tree itself changed, which always needs review.
        if drift:
            print("::error::No PR-controlled checkout left in "
                  + AUDITED_PATH + " but the trusted tree changed; "
                  "needs human review.")
            return 1
        print("::notice::No PR-controlled checkout in " + AUDITED_PATH
              + "; exemption inactive.")
        return 0
    audit_pr_checkout(ctx, drift)
    audit_trusted_checkout(ctx, drift)
    audit_resolver(ctx, drift)
    audit_path_literals(ctx, drift)
    audit_invocations(ctx, drift)
    audit_script_dir(ctx, drift)
    audit_run_hygiene(ctx, drift)
    audit_step_commands(ctx, drift)
    audit_agent_env(ctx, drift)
    audit_agent_runner(drift)
    audit_installer(drift)
    audit_helpers(ctx, drift)
    if drift:
        print(f"::error::muse-code-review.yml hardening drifted "
              f"({', '.join(drift)}); keeping SARIF unfiltered.")
        return 1

    def is_audited_checkout(result):
        suppressions = result.get("suppressions") or []
        if not suppressions or not all(
                s.get("kind") == "inSource" for s in suppressions):
            return False
        if result.get("ruleId") != AUDITED_RULE_ID:
            return False
        locations = result.get("locations", [])
        if not locations:
            return False
        for loc in locations:
            physical = loc.get("physicalLocation", {})
            uri = (physical.get("artifactLocation", {}).get("uri", "")
                   or "").replace("\\", "/").strip()
            # Exact normalized match: a suffix test would also accept
            # a nested lookalike (e.g. archive/.github/workflows/...).
            if posixpath.normpath(uri) != AUDITED_PATH:
                return False
            # Pin the exact audited finding by region, not just the
            # file: a second suppressed checkout elsewhere in the
            # workflow must stay visible. The span is computed from
            # the workflow itself (no hardcoded lines, no snippet
            # dependency); anything unlocatable fails closed.
            start_line = physical.get("region", {}).get("startLine")
            if not isinstance(start_line, int):
                return False
            if not ctx.span[0] or not (ctx.span[0]
                                         <= start_line <= ctx.span[1]):
                return False
        return True

    if not (os.path.isfile("semgrep.sarif")
            and os.path.getsize("semgrep.sarif") > 0):
        # Empty scan (e.g. a runner-only PR): the audit above still
        # ran and passed; there is just nothing to filter.
        print("::notice::Drift audit passed with no SARIF to filter "
              "(empty scan); exemption inactive.")
        sys.exit(0)
    try:
        with open("semgrep.sarif") as fh:
            sarif = json.load(fh)
    except (json.JSONDecodeError, OSError) as exc:
        # A truncated/unreadable scan artifact must fail loudly with
        # cause, not with a raw traceback.
        print(f"::error::SARIF parse failed ({exc}); keeping "
              f"semgrep.sarif unfiltered.")
        return 1
    for run in sarif.get("runs", []):
        kept = []
        for result in run.get("results", []):
            if is_audited_checkout(result):
                continue
            kept.append(result)
            # Shape/suppression drift is fail-closed (the alert
            # re-opens) but otherwise silent: surface it so the
            # cause (emitter shape change vs removed nosemgrep) is
            # investigated instead of the filter being blamed.
            for loc in result.get("locations", []):
                physical = loc.get("physicalLocation", {})
                uri = (physical.get("artifactLocation", {})
                       .get("uri", "") or "").replace("\\", "/").strip()
                if result.get("ruleId") == AUDITED_RULE_ID \
                        and posixpath.normpath(uri) == AUDITED_PATH:
                    print("::warning::Audited checkout finding present "
                          "but not filtered (suppressions removed or "
                          "SARIF shape changed?); alert 1498 may "
                          "re-open. Audit: " + AUDITED_PATH + ".")
                    break
        run["results"] = kept
    with open("semgrep.sarif", "w") as fh:
        json.dump(sarif, fh)


if __name__ == "__main__":
    sys.exit(main())
