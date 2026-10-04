"""Helper-tree orchestration: per-file audit driver, workflow
${SCRIPT_DIR} reference enumeration, and the trusted-changed
gate.
"""
import os
import re
from semgrep_sarif_cmdfile import audit_github_cmdfile_body
from semgrep_sarif_helpers import _audit_expansions, _audit_line
from semgrep_sarif_heredoc import _strip_heredocs
from semgrep_sarif_segments import logical_lines
from semgrep_sarif_varmap import _collect_vars, _resolve


def _audit_shell_file(path, drift):
    try:
        with open(path) as fh:
            raw = fh.read().splitlines()
    except OSError:
        drift.append("helper-unreadable")
        return
    varmap, stale, namerefs, opaque = _collect_vars(raw)
    src = os.path.basename(path)
    code, bodies, env_bodies = _strip_heredocs(raw)
    for line in logical_lines(code):
        _audit_line(_resolve(line, varmap, namerefs), drift,
                    src, stale, opaque)
    for line in bodies:
        _audit_expansions(_resolve(line, varmap, namerefs),
                           drift, src, stale, opaque)
    for kind, quoted, line in env_bodies:
        audit_github_cmdfile_body(
            kind, _resolve(line, varmap, namerefs), drift,
            quoted)


def invoked_shell_refs(raw):
    # .sh names the workflow routes via ${SCRIPT_DIR} (plus lib.sh,
    # sourced by every helper): referenced-but-missing drifts.
    invoked = set(re.findall(
        r"\$\{SCRIPT_DIR\}/([\w][\w.-]*\.sh)", raw))
    compact = re.sub(r"\s+", "", raw)
    invoked.update(re.findall(
        r"steps\.scriptdir\.outputs\.dir\}\}/"
        r"([\w][\w.-]*\.sh)", compact))
    invoked.add("lib.sh")
    return invoked


def audit_trusted_changed(drift):
    if os.environ.get("TRUSTED_CHANGED") == "true" \
            and "trusted-tree-changed" not in drift:
        drift.append("trusted-tree-changed")
