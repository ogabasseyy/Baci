"""Installer binding: the install step must place exactly the
verified temporary binary at exactly the final Muse path —
source/destination operands, single mktemp/HOME bindings, and
no later overwrites of the installed binary.
"""
import re
from semgrep_sarif_poison import _read_names
from semgrep_sarif_scan import redirect_targets
from semgrep_sarif_shell import tokenize
from semgrep_sarif_varmap import _split_top

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


def _refs_frozen(text, frozen):
    return any(re.search(r"\$\{?" + n + r"\b", text)
               for n in frozen)


def _rebind_names(piece):
    # read/printf -v/for/select targets on one piece. mapfile
    # yields content and getopts single chars, never paths.
    names = []
    toks = tokenize(piece)
    for i, tok in enumerate(toks):
        if tok == "read":
            names.extend(_read_names(toks[i + 1:])
                         or ["REPLY"])
        elif tok == "-v" and i + 1 < len(toks):
            names.append(toks[i + 1])
        elif tok.startswith("-v") and len(tok) > 2 \
                and not tok.startswith("--"):
            names.append(tok[2:])
    m = re.match(r"\s*(?:for|select)\s+([A-Za-z_]\w*)",
                 piece)
    if m:
        names.append(m.group(1))
    return [n.strip("\"'") for n in names
            if re.fullmatch(r"[A-Za-z_]\w*",
                            n.strip("\"'"))]


def audit_tmp_aliases(installer):
    # Names whose value derives from $tmp_bin (the frozen
    # artifact path): direct assigns anywhere in the file plus
    # read/printf -v/for rebinds, closed transitively. Only
    # $-references count (a bare `replacement` is a literal
    # filename). got_sha joins textually but is never written
    # post-verify: harmless.
    frozen = {"tmp_bin"}
    changed = True
    while changed:
        changed = False
        for line in installer:
            for seg in _split_top(line, (";",)):
                for piece in _split_top(seg, ("&&", "||")):
                    text = piece.strip()
                    m = re.match(
                        r"(?:export|declare|local|readonly|"
                        r"typeset)?\s*([A-Za-z_]\w*)=(.*)$",
                        text)
                    if m and _refs_frozen(m.group(2), frozen) \
                            and m.group(1) not in frozen:
                        frozen.add(m.group(1))
                        changed = True
                    if _refs_frozen(text, frozen):
                        for name in _rebind_names(text):
                            if name not in frozen:
                                frozen.add(name)
                                changed = True
    return frozen


def _is_compare_if(line):
    # Exact fail-closed shape: if [[ "${got_sha}" !=
    # "${want_sha}" ]]; then ([...] equivalent allowed). No
    # single quotes (literal!), no == (inverted), no &&/||/!
    # (neutralizers), nothing after then.
    if "'" in line or "&&" in line or "||" in line:
        return False
    if "!" in line.replace("!=", ""):
        return False
    return re.match(
        r"^\s*if\s+(?:\[\[\s+|\[\s+)"
        r"\"?\$\{?got_sha\}?\"?"
        r"\s*!=\s*"
        r"\"?\$\{?want_sha\}?\"?"
        r"\s*(?:\]\]|\])\s*;?\s*then\s*$", line) is not None


def _compare_block_ok(installer, at):
    # The then-branch allows echo/printf/:/true/assigns/blank
    # only, requires an explicit exit 1-255, and forbids
    # else/elif/nesting (a bare exit would exit $?, which is 0
    # on the taken mismatch path).
    saw_exit = False
    for line in installer[at + 1:]:
        s = line.strip()
        if not s:
            continue
        if re.match(r"^(if|for|while|until|select|case)\b",
                    s):
            return False
        if re.match(r"^(else|elif)\b", s):
            return False
        if re.match(r"^fi\s*(?:;|$)", s):
            return saw_exit
        if re.match(r"^(echo|printf|:|true)\b", s):
            continue
        if re.match(r"^exit\b", s):
            if re.match(r"^exit\s+[1-9][0-9]*\s*(?:;|$)",
                        s):
                saw_exit = True
                continue
            return False
        if re.match(r"^(?:export|declare|local|readonly|"
                    r"typeset)?\s*[A-Za-z_]\w*=", s):
            continue
        return False
    return False


def _errexit_on_at(installer, at):
    # errexit state above a line: last set wins (set -euo,
    # set -o errexit turn on; +e/+o and `set -- -e` do not).
    on = False
    for line in installer[:at]:
        for seg in _split_top(line.strip(), (";",)):
            toks = seg.split()
            if not toks or toks[0] != "set":
                continue
            i = 1
            while i < len(toks):
                tok = toks[i]
                if tok == "--":
                    break
                if tok == "-o" and i + 1 < len(toks):
                    on = toks[i + 1] == "errexit"
                    i += 2
                elif tok == "+o" and i + 1 < len(toks):
                    if toks[i + 1] == "errexit":
                        on = False
                    i += 2
                elif re.fullmatch(r"-[A-Za-z]+", tok):
                    on = "e" in tok or on
                    i += 1
                elif re.fullmatch(r"\+[A-Za-z]+", tok):
                    if "e" in tok:
                        on = False
                    i += 1
                else:
                    i += 1
    return on


def _is_check_line(line):
    # sha256sum -c alternative: any pipe (failure masked),
    # !, or if/while/until wrap voids it; the caller adds
    # the errexit requirement.
    if "|" in line or "!" in line:
        return False
    if re.match(r"^\s*(if|while|until)\b", line):
        return False
    toks = [t.strip("\"'") for t in tokenize(line)]
    return any(t.rsplit("/", 1)[-1] == "sha256sum"
               for t in toks) \
        and ("-c" in toks or "--check" in toks)


def audit_compare_shape(installer, drift):
    # Indices of valid fail-closed compares: the strict if
    # shape with a guarded then-branch, or sha256sum -c under
    # errexit. Empty drifts muse-installer-no-compare.
    idx = [i for i, line in enumerate(installer)
           if _is_compare_if(line)
           and _compare_block_ok(installer, i)]
    idx += [i for i, line in enumerate(installer)
            if _is_check_line(line)
            and _errexit_on_at(installer, i)]
    if not idx and "muse-installer-no-compare" not in drift:
        drift.append("muse-installer-no-compare")
    return idx
