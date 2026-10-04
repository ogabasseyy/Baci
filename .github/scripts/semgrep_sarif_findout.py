"""Find listing-output guard: -fls/-fprint/-fprintf write
attacker-influenced filenames into the named file, so the
file operand takes the destination rule like any copy
target. Split from semgrep_sarif_copy (300-line limit).
"""
from semgrep_sarif_scan import github_cmdfile_kind
from semgrep_sarif_zone import _write_zone


def audit_find_output(rest, drift):
    # find -fls/-fprint/-fprintf write listings into the named
    # file (attacker-influenced filenames); the file operand
    # takes the destination rule like any copy target.
    for i, tok in enumerate(rest):
        if tok in ("-fls", "-fprint", "-fprint0", "-fprintf") \
                and i + 1 < len(rest):
            zone = _write_zone(rest[i + 1])
            if zone == "trusted" \
                    and "helper-trusted-write" not in drift:
                drift.append("helper-trusted-write")
            if zone == "workspace" \
                    and "helper-workspace-write" not in drift:
                drift.append("helper-workspace-write")
            if zone == "glob" \
                    and "helper-unzoneable-write" not in drift:
                drift.append("helper-unzoneable-write")
            if github_cmdfile_kind(rest[i + 1]) is not None \
                    and "helper-env-poison" not in drift:
                drift.append("helper-env-poison")
