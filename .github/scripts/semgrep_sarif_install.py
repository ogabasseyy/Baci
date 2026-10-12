"""Installer binding: the install step must place exactly the
verified temporary binary at exactly the final Muse path —
source/destination operands, single mktemp/HOME bindings, and
no later overwrites of the installed binary.
"""
import re
from semgrep_sarif_redirect import redirect_targets
from semgrep_sarif_shell import tokenize
from semgrep_sarif_nameref import _split_top

MUSE_DEST_MARK = "install_dir}/muse"
WANT_SOURCE = '"${tmp_bin}"'
WANT_DEST = '"${install_dir}/muse"'
_VALUE_FLAGS = {"-m", "-o", "-g"}


def _installer_curl_ok(rest):
    # The install.sh download curl stays exempt from the
    # network rule only when it cannot load attacker config:
    # --disable/-q first (curl reads $CURL_HOME/.curlrc or
    # $HOME/.curlrc unless disabled as the first parameter)
    # and no -K/--config anywhere (a config imports upload-file
    # plus an attacker url as command-line arguments).
    if not rest or rest[0] not in ("-q", "--disable"):
        return False
    for tok in rest:
        if tok in ("-K", "--config") \
                or tok.startswith("--config=") \
                or tok.startswith("-K"):
            return False
        if re.fullmatch(r"-[a-zA-Z]+", tok) and "K" in tok:
            return False
    return True


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
        # A shell function or alias named install/cp/mv/ln/tee
        # shadows the audited install line: the verified tmp
        # binary never lands and attacker bytes do instead.
        # All three function spellings (name(), function name,
        # function name()) plus alias defs drift.
        if re.match(r"^(?:function\s+)?(install|cp|mv|ln|tee)"
                    r"(?:\s*\(\s*\))?\s*(\{|$|;)",
                    line.strip()) \
                or re.match(r"^alias\s+(install|cp|mv|ln|tee)=",
                            line.strip()):
            if "muse-installer-shadow" not in drift:
                drift.append("muse-installer-shadow")
        for tgt in redirect_targets(line):
            if MUSE_DEST_MARK in tgt \
                    and "muse-installer-overwrite" not in drift:
                drift.append("muse-installer-overwrite")
    return at


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
            # Statuses wrap mod 256 (exit 256 exits 0!), so
            # only 1-255 prove the mismatch branch fails.
            if re.match(r"^exit\s+(25[0-5]|2[0-4][0-9]|"
                        r"1[0-9][0-9]|[1-9][0-9]?)\s*(?:;|$)",
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
                    # Only errexit enables; other options
                    # (pipefail) leave the state unchanged.
                    if toks[i + 1] == "errexit":
                        on = True
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
