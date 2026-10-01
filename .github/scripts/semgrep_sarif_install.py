"""Installer binding: the install step must place exactly the
verified temporary binary at exactly the final Muse path —
source/destination operands, single mktemp/HOME bindings, and
no later overwrites of the installed binary.
"""
import re
from semgrep_sarif_scan import redirect_targets

MUSE_DEST_MARK = "install_dir}/muse"
WANT_SOURCE = '"${tmp_bin}"'
WANT_DEST = '"${install_dir}/muse"'
_VALUE_FLAGS = {"-m", "-o", "-g"}


def _install_operands(words):
    # Non-flag operands of an install command. Unknown --flags
    # consume a value (fail closed: a miscounted operand drifts
    # below for human review).
    ops = []
    i = 1
    while i < len(words):
        tok = words[i]
        if tok == "--":
            ops.extend(words[i + 1:])
            break
        if tok in _VALUE_FLAGS:
            i += 2
        elif tok.startswith("--"):
            i += 1 if "=" in tok else 2
        elif tok.startswith("-") and len(tok) > 1:
            i += 1
        else:
            ops.append(tok)
            i += 1
    return ops


def audit_install_binding(installer, first_cmd, drift):
    # Returns install-line indices for the verify-before-install
    # order check. Source and destination must match the
    # verified temp binary and final path exactly; the tmp/dir
    # bindings must be single mktemp/HOME assignments; any
    # second install, copy/move/link/tee onto the destination,
    # or redirect there drifts.
    at = [i for i, line in enumerate(installer)
          if first_cmd(line) == "install"]
    if not at:
        drift.append("muse-installer-no-install")
    else:
        if len(at) > 1 \
                and "muse-installer-overwrite" not in drift:
            drift.append("muse-installer-overwrite")
        for i in at:
            if _install_operands(installer[i].split()) \
                    != [WANT_SOURCE, WANT_DEST] \
                    and "muse-installer-source" not in drift:
                drift.append("muse-installer-source")
    for var, mark in (("tmp_bin", "mktemp"),
                      ("install_dir", "${HOME}/.local/bin")):
        bound = [line for line in installer if re.match(
            r"^(?:(?:export|declare|local|readonly|typeset)\s+)?"
            + var + "=", line.strip())]
        if len(bound) != 1 or mark not in bound[0]:
            if "muse-installer-rebind" not in drift:
                drift.append("muse-installer-rebind")
    for line in installer:
        if first_cmd(line) in ("cp", "mv", "ln", "tee") \
                and MUSE_DEST_MARK in line \
                and "muse-installer-overwrite" not in drift:
            drift.append("muse-installer-overwrite")
        for tgt in redirect_targets(line):
            if MUSE_DEST_MARK in tgt \
                    and "muse-installer-overwrite" not in drift:
                drift.append("muse-installer-overwrite")
    return at
