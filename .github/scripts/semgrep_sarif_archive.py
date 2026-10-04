"""7-Zip destination audit: extraction -o dir and archive
mutation (a/u/d/rn archive operand) zone like copy targets.
Bare extraction restores static members (silent, like tar).
"""
import re
from semgrep_sarif_scan import github_cmdfile_kind
from semgrep_sarif_zone import _write_zone

ARCHIVE_TOOLS = {"7z", "7za"}

_EXTRACT_CMDS = {"x", "e"}
_MUTATE_CMDS = {"a", "u", "d", "rn"}


def _seven_z_parts(rest):
    # (command, archive-or-None): the command is the first
    # operand (7z fixes it before the archive; switches
    # skipped); the archive is the first operand after it.
    # A non-command first operand means invalid 7z (silent:
    # 7z errors without writing).
    cmd, cmd_i = None, -1
    for i, tok in enumerate(rest):
        if tok == "--":
            break
        if tok.startswith("-") or not tok:
            continue
        if not re.fullmatch(r"[a-zA-Z]{1,2}", tok):
            return None, None
        cmd, cmd_i = tok, i
        break
    if cmd is None:
        return None, None
    for tok in rest[cmd_i + 1:]:
        if tok == "--":
            break
        if tok.startswith("-") or not tok:
            continue
        return cmd, tok
    return cmd, None


def _seven_z_outdir(rest):
    # Glued -o dir (7z has no spaced form); bare -o extracts
    # to CWD (static members: silent, like tar without -C).
    for tok in rest:
        if tok.startswith("-o") and len(tok) > 2:
            return tok[2:]
    return None


def audit_archive_dest(rest, drift):
    # 7z/7za destinations take the copy-target rule: the
    # extraction dir, or the archive operand a/u/d/rn mutate.
    targets = []
    cmd, arch = _seven_z_parts(rest)
    if cmd in _EXTRACT_CMDS:
        outd = _seven_z_outdir(rest)
        if outd is not None:
            targets = [outd]
    elif cmd in _MUTATE_CMDS and arch is not None:
        targets = [arch]
    zones = {_write_zone(t) for t in targets}
    zones.discard(None)
    if "trusted" in zones \
            and "helper-trusted-write" not in drift:
        drift.append("helper-trusted-write")
    if "workspace" in zones \
            and "helper-workspace-write" not in drift:
        drift.append("helper-workspace-write")
    if "glob" in zones \
            and "helper-unzoneable-write" not in drift:
        drift.append("helper-unzoneable-write")
    kinds = {github_cmdfile_kind(t) for t in targets}
    kinds.discard(None)
    if kinds and "helper-env-poison" not in drift:
        drift.append("helper-env-poison")
