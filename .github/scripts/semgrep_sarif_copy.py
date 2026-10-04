"""Copy-class destination guards: tools that place bytes must
not target the trusted tree, the muse binary (or its ancestor
dirs -- a link swap redirects the absolute-path invocation),
or the agent-readable workspace (token staging). Reads are
safe: only destinations (plus patch programs, which carry
taint) are checked -- and execution channels: tar program
flags (see semgrep_sarif_tar), sed programs (see
semgrep_sarif_sed), ed/ex (denied:
unseen stdin scripts with shell escapes), and link sources
(a trusted/workspace/relative source aliases later writes
into the protected tree). Copy-class targets that are the
Actions command files (cp/mv/tee/dd into $GITHUB_ENV or
$GITHUB_PATH) replace the whole file with unseen bytes, so
they drift value-insensitively (helper-env-poison);
shell redirections split by writer (see
semgrep_sarif_poison).
"""
import re
from semgrep_sarif_install import _install_operands
from semgrep_sarif_scan import github_cmdfile_kind
from semgrep_sarif_zone import _write_zone
from semgrep_sarif_sed import audit_sed_programs
from semgrep_sarif_tar import audit_tar_exec
from semgrep_sarif_binutils import (_canon_binutils,
                                     _dash_o_output,
                                     audit_binutils_targets)
from semgrep_sarif_words import (_flag_value, _operands,
                                 _tool_operands)

COPY_TOOLS = {"cp", "mv", "ln", "install", "tee", "dd", "tar",
              "unzip", "zip", "patch", "ed", "ex", "sed",
              "objcopy", "ld", "as", "strip", "ar", "ranlib",
              "sort", "iconv", "shuf", "uniq", "split",
              "csplit"}


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


def _cp_symbolic(rest):
    # cp -s/--symbolic-link (bundles included): -t consumes
    # its value, so -ts never misreads as symbolic.
    for tok in rest:
        if tok == "--":
            return False
        if tok == "--symbolic-link":
            return True
        if tok.startswith("-") and not tok.startswith("--") \
                and len(tok) > 1:
            for ch in tok[1:]:
                if ch == "s":
                    return True
                if ch == "t":
                    break
    return False


def _link_sources(rest):
    # Link sources: every operand but the destination (all of
    # them under -t; the lone operand links into the CWD,
    # which is the workspace at helper runtime).
    tdir = _flag_value(rest, ("-t", "--target-directory"))
    ops = _operands(rest)
    if tdir is not None:
        return [op for op in ops if op != tdir]
    if len(ops) <= 1:
        return ops
    return ops[:-1]


def _source_alias(src):
    # A link source that resolves into (or cannot be shown
    # outside) the trusted tree or workspace: writes through
    # the link land there. Absolute system/tmp paths pass.
    zone = _write_zone(src)
    if zone in ("trusted", "workspace", "glob"):
        return True
    return zone is None and not src.startswith("/")


def audit_link_sources(base, rest, drift):
    if base != "ln" and not (base == "cp" and _cp_symbolic(rest)):
        return
    for src in _link_sources(rest):
        if _source_alias(src):
            if "helper-symlink-alias" not in drift:
                drift.append("helper-symlink-alias")
            break


def audit_copy_dest(base, rest, drift, src=""):
    # LLVM-prefixed/versioned binutils audit as their GNU
    # original (llvm-objcopy plants the same bytes).
    base = _canon_binutils(base) or base
    if base == "install" and src == "install.sh":
        # Structurally audited: the binding rules pin its
        # operands exactly, so the helper pass stands down.
        return
    audit_link_sources(base, rest, drift)
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
        audit_tar_exec(rest, drift)
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
        # Scripted edits with shell escapes (!cmd): the audit
        # cannot see stdin, so any invocation drifts.
        if "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
        ops = _operands(rest)
        if ops:
            targets = [ops[0]]
        else:
            implicit = "trusted"  # e-command can name anything
    elif base == "sed":
        targets = audit_sed_programs(rest, drift)
        if _is_inplace(rest):
            targets += _sed_files(rest)
    elif base in ("objcopy", "ld", "as", "strip", "ar",
                     "ranlib"):
        bin_targets, bin_implicit = audit_binutils_targets(
            base, rest)
        targets += bin_targets
        if bin_implicit is not None:
            implicit = bin_implicit
    elif base in ("sort", "iconv", "shuf"):
        # -o/--output destination (separate, =, or glued);
        # sort -T/--temporary-directory holds sort chunks.
        # sort --compress-program executes its operand.
        out = _dash_o_output(rest)
        if out is not None:
            targets.append(out)
        if base == "sort":
            tmp = _flag_value(
                rest, ("-T", "--temporary-directory"))
            if tmp is not None:
                targets.append(tmp)
            if any(tok == "--compress-program"
                   or tok.startswith("--compress-program=")
                   for tok in rest) \
                    and "helper-untrusted-exec" not in drift:
                drift.append("helper-untrusted-exec")
    elif base == "uniq":
        # uniq [input [output]]: the positional output file
        # (-f/-s/-w take values, so naive operands misread).
        ops = _tool_operands(
            rest, "fsw", ("--skip-fields", "--skip-chars",
                          "--check-chars"))
        if len(ops) >= 2:
            targets.append(ops[-1])
    elif base == "split":
        # split [input] [prefix]: --filter executes per
        # chunk; outputs land under prefix (default ./x).
        if any(tok == "--filter"
               or tok.startswith("--filter=")
               for tok in rest) \
                and "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
        ops = _tool_operands(
            rest, "abClnt", ("--bytes", "--line-bytes",
                            "--lines", "--number",
                            "--separator", "--filter",
                            "--suffix-length",
                            "--additional-suffix"))
        if len(ops) >= 2:
            targets.append(ops[-1])
        else:
            implicit = "workspace"
    elif base == "csplit":
        # csplit takes its prefix via -f/--prefix (positional
        # operands after the file are patterns).
        pref = _flag_value(rest, ("-f", "--prefix"))
        if pref is not None:
            targets.append(pref)
        else:
            implicit = "workspace"
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
    if "glob" in zones \
            and "helper-unzoneable-write" not in drift:
        drift.append("helper-unzoneable-write")
    kinds = {github_cmdfile_kind(t) for t in targets}
    kinds.discard(None)
    if kinds and "helper-env-poison" not in drift:
        drift.append("helper-env-poison")


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
