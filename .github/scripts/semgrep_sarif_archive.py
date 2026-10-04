"""7-Zip destination audit: extraction -o dir and archive
mutation (a/u/d/rn archive operand) zone like copy targets.
Extraction without -o lands in CWD (implicit workspace
write, like tar without -C / unzip without -d).
dpkg-deb likewise: -x/-X/-e extract (archive [dir], dir
defaulting under CWD); -b builds (dir [archive], default
dir.deb in CWD). Info actions only read.
"""
import re
from semgrep_sarif_scan import github_cmdfile_kind
from semgrep_sarif_words import _tool_operands
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
    implicit = None
    cmd, arch = _seven_z_parts(rest)
    if cmd in _EXTRACT_CMDS:
        outd = _seven_z_outdir(rest)
        if outd is not None:
            targets = [outd]
        else:
            # No -o: full-path extraction lands in CWD (the
            # workspace), replacing trusted files by default.
            implicit = "workspace"
    elif cmd in _MUTATE_CMDS and arch is not None:
        targets = [arch]
    _emit_zones(targets, implicit, drift)


def _emit_zones(targets, implicit, drift):
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


_DPKG_VALUE_LONGS = {"--compression", "--compression-level",
                      "--showformat", "--uniform-compression"}


def _dpkg_action(rest):
    # First dpkg-deb action: x (extract incl. -X/-e), b
    # (build), r (read-only info), or None. getopt bundles
    # scanned left to right; Z/z/S swallow the rest of their
    # token as the value.
    for tok in rest:
        if tok == "--":
            return None
        if tok in ("-x", "-X", "-e", "--extract", "--control"):
            return "x"
        if tok in ("-b", "--build"):
            return "b"
        if tok in ("-f", "-c", "-I", "-W", "--field",
                   "--contents", "--info", "--show",
                   "--fsys-tarfile", "--ctrl-tarfile"):
            return "r"
        m = re.fullmatch(r"-([a-zA-Z]+)", tok)
        if m:
            for ch in m.group(1):
                if ch in "ZzS":
                    break
                if ch in "xXe":
                    return "x"
                if ch == "b":
                    return "b"
                if ch in "fcIW":
                    return "r"
    return None


def audit_dpkg_dest(rest, drift):
    # dpkg-deb destinations take the copy-target rule. Both
    # -x (archive [dir]) and -b (dir [archive]) write their
    # second operand, defaulting under CWD when omitted.
    act = _dpkg_action(rest)
    if act not in ("x", "b"):
        return
    ops = _tool_operands(rest, set("ZzS"), _DPKG_VALUE_LONGS)
    if len(ops) > 1:
        _emit_zones([ops[1]], None, drift)
    else:
        _emit_zones([], "workspace", drift)


_JAR_VALUE_LONGS = ("--file", "--manifest", "--main-class",
                      "--release", "--module-version")


def _jar_letters(word):
    # Action coined by jar op letters (x extract, c/u/i
    # write the archive, t/d read only), else None.
    for ch in word:
        if ch == "x":
            return "x"
        if ch in "cui":
            return "w"
        if ch in "td":
            return "r"
    return None


def _jar_action(rest):
    # First jar operation as (action, token index): x, w,
    # r, or (None, None). Dashed bundles scanned left to
    # right (value shorts f/e/m/C swallow the rest of
    # their bundle, like getopt); a dashless pure-letter
    # word (jar cf) also coins one. Flag values are
    # skipped so -C/-f operands cannot misread as
    # operations in any argument order.
    skip = False
    for idx, tok in enumerate(rest):
        if skip:
            skip = False
            continue
        if tok == "--":
            return None, None
        if tok == "--extract":
            return "x", idx
        if tok in ("--create", "--update"):
            return "w", idx
        if tok in ("--list", "--describe-module"):
            return "r", idx
        if tok in _JAR_VALUE_LONGS:
            skip = True
            continue
        if tok.startswith(_JAR_VALUE_LONGS):
            continue
        m = re.fullmatch(r"-([a-zA-Z]+)", tok)
        if m:
            letters = m.group(1)
            for pos, ch in enumerate(letters):
                if ch in "femC":
                    if pos == len(letters) - 1:
                        skip = True
                    break
                hit = _jar_letters(ch)
                if hit is not None:
                    return hit, idx
        elif re.fullmatch(r"[a-zA-Z]+", tok):
            hit = _jar_letters(tok)
            if hit is not None:
                return hit, idx
    return None, None


def _jar_file(rest):
    # The -f/--file archive operand (separate, =-glued,
    # or bundled rest-of-token, else the next token):
    # create/update/index write it.
    i = 0
    while i < len(rest):
        tok = rest[i]
        if tok == "--":
            return None
        if tok in ("-f", "--file"):
            return rest[i + 1] if i + 1 < len(rest) else None
        if tok.startswith("--file="):
            return tok.split("=", 1)[1]
        m = re.fullmatch(r"-([a-zA-Z]+)", tok)
        if m and "f" in m.group(1):
            tail = m.group(1).split("f", 1)[1]
            if tail:
                return tail
            return rest[i + 1] if i + 1 < len(rest) else None
        i += 1
    return None


def _jar_dirs(rest):
    # Every -C dir (separate or glued): extraction roots
    # for the members that follow each one (a second flag
    # would otherwise smuggle its destination).
    dirs, i = [], 0
    while i < len(rest):
        tok = rest[i]
        if tok == "--":
            break
        if tok == "-C" and i + 1 < len(rest):
            dirs.append(rest[i + 1])
            i += 2
        elif re.fullmatch(r"-C\S+", tok):
            dirs.append(tok[2:])
            i += 1
        else:
            i += 1
    return dirs


def audit_jar_dest(rest, drift):
    # jar destinations take the copy-target rule. -x extracts
    # members under each -C dir (CWD when no -C: replacing
    # trusted files by default, like tar without -C);
    # -c/-u/-i write the -f archive (-f - is stdout, zoned
    # with redirects). List/describe only read.
    act, at = _jar_action(rest)
    if act == "x":
        dirs = _jar_dirs(rest)
        if dirs:
            _emit_zones(dirs, None, drift)
        else:
            _emit_zones([], "workspace", drift)
    elif act == "w":
        arch = _jar_file(rest)
        if arch is None and at is not None \
                and not rest[at].startswith("-"):
            # Dashless create/update (jar cf archive): the
            # archive is the first surviving operand past
            # the operation word (a dashed -c without -f
            # writes stdout, zoned with redirects).
            ops = _tool_operands(rest[at + 1:], "femC",
                                 _JAR_VALUE_LONGS)
            if ops:
                arch = ops[0]
        if arch is not None:
            _emit_zones([arch], None, drift)
