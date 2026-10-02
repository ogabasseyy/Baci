"""git allowlist: helpers run fetch/diff/show/merge-base/config
only. -c keys are core.quotePath only; -C/--exec-path=/
--config-env/--git-dir/--work-tree re-point git at attacker
state (dirs, configs, subcommand binaries); config writes plant
aliases/drivers while reads pass; clone/commit/checkout/execute
network, hooks, or smudge filters. fetch stays origin-pinned
with no upload-pack/exec/refmap/stdin; diff/show share the
--ext-diff/--textconv deny with a zoned --output. Unknown
global flags are skipped: git rejects them before executing.
"""
import re
from semgrep_sarif_pins import _is_home_write
from semgrep_sarif_scan import _write_zone

GIT_ALLOW = {"fetch", "merge-base", "diff", "show", "config"}
C_ALLOW = {"core.quotePath"}
_SAFE_GLOBAL = {"--paginate", "-p", "--no-pager", "--bare",
                "--version", "--help", "-h", "--html-path",
                "--man-path", "--info-path", "--exec-path"}
_FETCH_VALUES = {"--depth", "--deepen", "--jobs", "-j",
                 "--server-option", "-o"}
_FETCH_DENY = ("--upload-pack", "--exec", "--recurse-submodules",
               "--refmap", "--stdin", "--multiple")


def _drift(drift):
    if "helper-untrusted-exec" not in drift:
        drift.append("helper-untrusted-exec")


def _zone_target(target, drift):
    zone = _write_zone(target)
    if zone == "trusted" \
            and "helper-trusted-write" not in drift:
        drift.append("helper-trusted-write")
    if zone == "workspace" \
            and "helper-workspace-write" not in drift:
        drift.append("helper-workspace-write")
    if _is_home_write(target) \
            and "helper-home-write" not in drift:
        drift.append("helper-home-write")


def _bad_key(key):
    return key.split("=", 1)[0] not in C_ALLOW


def _audit_config(args, drift):
    # Config operands (flags permute anywhere): writes need an
    # allowlisted key, --edit spawns $EDITOR, single-operand
    # reads and removals pass.
    flags = {a for a in args if a.startswith("-")}
    ops = [a for a in args if not a.startswith("-")]
    if "-e" in flags or "--edit" in flags:
        _drift(drift)
        return
    if not ops:
        return
    if "--unset" in flags or "--unset-all" in flags \
            or "--remove-section" in flags \
            or "--rename-section" in flags:
        return
    if len(ops) >= 2 or "--add" in flags \
            or "--replace-all" in flags:
        if _bad_key(ops[0]):
            _drift(drift)


def _audit_fetch(args, drift):
    # Origin-pinned ref fetch: the remote must be origin (the
    # clone-written remote), refspec colons would clobber local
    # refs, and upload-pack/exec run remote-side commands.
    i, operands = 0, []
    while i < len(args):
        tok = args[i]
        if tok == "--":
            operands.extend(args[i + 1:])
            break
        if tok in _FETCH_VALUES:
            i += 2
        elif any(tok.startswith(d) for d in _FETCH_DENY):
            _drift(drift)
            return
        elif tok.startswith("-"):
            i += 1
        else:
            operands.append(tok)
            i += 1
    if not operands:
        return  # bare fetch: default remote from clone config
    if operands[0] != "origin":
        _drift(drift)
        return
    for ref in operands[1:]:
        if ":" in ref or "://" in ref:
            _drift(drift)
            return


def _audit_diff(args, drift):
    i = 0
    while i < len(args):
        tok = args[i]
        if tok == "--":
            return  # pathspecs past -- are reads
        if tok in ("--ext-diff", "--textconv"):
            _drift(drift)
            return
        if tok == "--output" and i + 1 < len(args):
            _zone_target(args[i + 1], drift)
            i += 2
        elif tok.startswith("--output="):
            _zone_target(tok[len("--output="):], drift)
            i += 1
        else:
            i += 1


def audit_git(rest, drift):
    i = 0
    while i < len(rest) and rest[i].startswith("-") \
            and rest[i] != "--":
        tok = rest[i]
        if tok == "-c":
            if i + 1 >= len(rest) \
                    or _bad_key(rest[i + 1]):
                _drift(drift)
                return
            i += 2
        elif tok.startswith("-c") and len(tok) > 2:
            if _bad_key(tok[2:]):
                _drift(drift)
                return
            i += 1
        elif tok.startswith("-C"):
            _drift(drift)  # runs git in an attacker dir
            return
        elif tok == "--config-env" \
                or tok.startswith("--config-env="):
            _drift(drift)  # -c allowlist bypass via environ
            return
        elif tok.startswith("--exec-path="):
            _drift(drift)  # subcommand binary hijack
            return
        elif tok in ("--git-dir", "--work-tree") \
                or tok.startswith("--git-dir=") \
                or tok.startswith("--work-tree="):
            _drift(drift)  # attacker .git: hooks and config
            return
        elif tok in _SAFE_GLOBAL or tok.startswith("-"):
            i += 1
    if i >= len(rest) or rest[i] == "--":
        return  # flags-only version/help, or invalid: no exec
    sub, args = rest[i], rest[i + 1:]
    if sub not in GIT_ALLOW:
        _drift(drift)
        return
    if sub == "fetch":
        _audit_fetch(args, drift)
    elif sub in ("diff", "show"):
        _audit_diff(args, drift)
    elif sub == "config":
        _audit_config(args, drift)
    # merge-base is pure computation over commit operands.
