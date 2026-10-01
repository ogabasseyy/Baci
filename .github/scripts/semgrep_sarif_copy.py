"""Copy-class destination guards: tools that place bytes must
not target the trusted tree, the muse binary (or its ancestor
dirs -- a link swap redirects the absolute-path invocation),
or the agent-readable workspace (token staging). Reads are
safe: only destinations (plus patch/sed programs, which carry
taint) are checked. Residual: GITHUB_ENV/GITHUB_PATH writes
need value-sensitive rules (follow-up).
"""
from semgrep_sarif_install import _install_operands
from semgrep_sarif_scan import _write_zone

COPY_TOOLS = {"cp", "mv", "ln", "install", "tee", "dd", "tar",
              "unzip", "zip", "patch", "ed", "ex", "sed"}


def _operands(rest):
    ops, done = [], False
    for tok in rest:
        if not done and tok == "--":
            done = True
        elif not done and tok.startswith("-") and len(tok) > 1:
            continue
        else:
            ops.append(tok)
    return ops


def _flag_value(rest, names):
    i = 0
    while i < len(rest):
        tok = rest[i]
        if tok == "--":
            return None
        if tok in names and i + 1 < len(rest):
            return rest[i + 1]
        for name in names:
            if tok.startswith(name + "="):
                return tok.split("=", 1)[1]
        i += 1
    return None


def _sed_files(rest):
    # In-place subject files: -e/-f programs are data, every
    # other operand is rewritten.
    files, i = [], 0
    while i < len(rest):
        tok = rest[i]
        if tok in ("-e", "-f", "--expression", "--file"):
            i += 2
        elif tok.startswith(("--expression=", "--file=")):
            i += 1
        elif tok == "--":
            files.extend(rest[i + 1:])
            break
        elif tok.startswith("-") and len(tok) > 1:
            i += 1
        else:
            files.append(tok)
            i += 1
    return files


def _is_extract(rest):
    return any(
        tok in ("-x", "--extract", "--get")
        or (tok.startswith("-") and not tok.startswith("--")
            and "x" in tok[1:] and "=" not in tok)
        for tok in rest)


def _is_inplace(rest):
    return any(
        tok in ("-i", "--in-place")
        or tok.startswith("--in-place=")
        or (tok.startswith("-") and not tok.startswith("--")
            and "i" in tok[1:] and "=" not in tok)
        for tok in rest)


def audit_copy_dest(base, rest, drift, src=""):
    if base == "install" and src == "install.sh":
        # Structurally audited: the binding rules pin its
        # operands exactly, so the helper pass stands down.
        return
    targets, implicit = [], None
    if base in ("cp", "mv", "ln"):
        tdir = _flag_value(rest, ("-t", "--target-directory"))
        if tdir is not None:
            targets = [tdir]
        else:
            ops = _operands(rest)
            if ops:
                targets = [ops[-1]]
            if base == "ln" and len(ops) <= 1:
                # Single-operand ln links into CWD, which is
                # the workspace at helper runtime.
                implicit = "workspace"
    elif base == "install":
        ops = _install_operands(["install"] + list(rest))
        if ops:
            targets = [ops[-1]]
    elif base == "tee":
        targets = _operands(rest)
    elif base == "dd":
        targets = [tok[3:] for tok in rest
                   if tok.startswith("of=")]
    elif base == "tar":
        if _is_extract(rest):
            cdir = _flag_value(rest, ("-C", "--directory"))
            if cdir is not None:
                targets = [cdir]
        else:
            # Creation bundles member bytes (possibly staged
            # secrets) into the -f archive; extraction without
            # -C only restores static members, so it stays silent.
            arch = _flag_value(rest, ("-f", "--file"))
            if arch is not None:
                targets = [arch]
    elif base == "unzip":
        dest = _flag_value(rest, ("-d",))
        if dest is not None:
            targets = [dest]
    elif base == "zip":
        ops = _operands(rest)
        if ops:
            targets = [ops[0]]
    elif base == "patch":
        out = _flag_value(rest, ("-o",))
        if out is not None:
            targets = [out]
        else:
            targets = _operands(rest) + [
                v for v in (_flag_value(rest, ("-d",)),)
                if v is not None]
            if not targets:
                implicit = "trusted"  # stdin patch: unbounded
    elif base in ("ed", "ex"):
        ops = _operands(rest)
        if ops:
            targets = [ops[0]]
        else:
            implicit = "trusted"  # e-command can name anything
    elif base == "sed":
        if _is_inplace(rest):
            targets = _sed_files(rest)
    zones = {_write_zone(t) for t in targets}
    zones.discard(None)
    if implicit is not None:
        zones.add(implicit)
    if "trusted" in zones \
            and "helper-trusted-write" not in drift:
        drift.append("helper-trusted-write")
    if "workspace" in zones \
            and "helper-workspace-write" not in drift:
        drift.append("helper-workspace-write")
