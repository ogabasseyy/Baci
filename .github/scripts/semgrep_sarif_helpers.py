"""Token-bearing helper guards: every script the review executes
inherits runner tokens, so invoked helpers (plus lib.sh, which
they all source) must contain no indirection into the attacker
tree, no privilege change, and no writes into protected trees.
Directly hostile code is indistinguishable from legitimate token
use, so any trusted-tree change also fails for human review.
"""
import os
import re
from semgrep_sarif_interp import (_check_command,
                                   _check_poison_assign)
from semgrep_sarif_pins import _is_home_write
from semgrep_sarif_scan import (extract_subshells,
                                is_trusted_write_target,
                                redirect_targets, skip_braced)
from semgrep_sarif_shell import (SHELL_KEYWORDS, logical_lines,
                                 peel_prefix, split_commands2,
                                 tokenize, unquote)


CARRY_VARS = ("HOME", "GITHUB_WORKSPACE", "RUNNER_TEMP",
              "SCRIPT_DIR", "TMPDIR", "TEMP", "TMP")
def _strip_case_patterns(nosub):
    # Drop case pattern prefixes clause by clause (;;-separated,
    # quote-aware): the first ) at paren depth 0 ends the
    # pattern; subshell closes sit deeper and never cut. Body
    # commands after the ) are kept for analysis.
    clauses, buf, quote = [], "", None
    i = 0
    while i < len(nosub):
        ch = nosub[i]
        if quote:
            buf += ch
            if ch == quote:
                quote = None
            i += 1
        elif ch in ("'", '"'):
            quote, buf, i = ch, buf + ch, i + 1
        elif ch == ";" and nosub[i:i + 2] == ";;":
            j = i + 2
            if j < len(nosub) and nosub[j] in (";", "&"):
                j += 1
            clauses.append(buf)
            buf, i = "", j
        else:
            buf, i = buf + ch, i + 1
    clauses.append(buf)
    kept = []
    for clause in clauses:
        depth, quote, cut = 0, None, None
        i = 0
        while i < len(clause):
            ch = clause[i]
            if quote:
                if ch == quote:
                    quote = None
            elif ch in ("'", '"'):
                quote = ch
            elif ch == "(":
                depth += 1
            elif ch == ")":
                if depth == 0:
                    cut = i + 1
                    break
                depth -= 1
            i += 1
        kept.append(clause[cut:] if cut is not None else clause)
    return "; ".join(kept)


def _strip_heredocs(raw_lines):
    # Drop heredoc bodies (prose, not commands). Tracks quoted
    # and ${} regions so a << inside them cannot start a fake
    # body that would hide real code; <<< is a herestring,
    # never a heredoc. Empty delimiters never push.
    out, pending = [], []
    for line in raw_lines:
        if pending:
            delim, tabs = pending[0]
            text = line.lstrip("\t") if tabs else line
            if text == delim:
                pending.pop(0)
            out.append("")
            continue
        out.append(line)
        i, quote = 0, None
        while i < len(line):
            ch = line[i]
            if quote:
                if ch == quote:
                    quote = None
                i += 1
            elif ch in ("'", '"'):
                quote, i = ch, i + 1
            elif ch == "\\":
                i += 2
            elif ch == "#":
                break
            elif ch == "$" and line[i:i + 2] == "${":
                i = skip_braced(line, i)
            elif ch == "<" and line[i:i + 2] == "<<" \
                    and line[i:i + 3] != "<<<":
                j = i + 2
                tabs = False
                if j < len(line) and line[j] == "-":
                    tabs, j = True, j + 1
                while j < len(line) \
                        and line[j] in (" ", "\t"):
                    j += 1
                if j < len(line) and line[j] in ("'", '"'):
                    q, k = line[j], j + 1
                    while k < len(line) and line[k] != q:
                        k += 1
                    delim, j = line[j + 1:k], k + 1
                else:
                    k = j
                    while k < len(line) \
                            and line[k] not in (" ", "\t", ";",
                                                "|", "&", "(",
                                                ")", "<", ">"):
                        k += 1
                    delim, j = line[j:k], k
                if delim:
                    pending.append((delim, tabs))
                i = j
            else:
                i += 1
    return out


def _collect_vars(raw_lines):
    # First top-level literal assignment per name (bash first-
    # wins), so ${install_dir}/... resolves before path checks
    # and a ws= alias cannot launder an attacker path. Values
    # carrying anything but known env roots stay unresolved
    # (fail closed at use). Conditional/indented assigns never
    # resolve.
    carry = "(?:" + "|".join(CARRY_VARS) + ")"
    varmap = {}
    for line in raw_lines:
        m = re.match(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)"
                     r"=(.*)$", line)
        if not m or m.group(1) in varmap:
            continue
        val = m.group(2).strip()
        if len(val) >= 2 and val[0] == val[-1] \
                and val[0] in ("'", '"'):
            inner = val[1:-1]
        elif re.fullmatch(r"\S+", val or " "):
            inner = val
        else:
            continue
        if "`" in inner or "$(" in inner:
            continue
        scrubbed = re.sub(r"\$(?:\{" + carry + r"\}|" + carry
                           + r")", "", inner)
        if "$" in scrubbed:
            continue
        varmap[m.group(1)] = inner
    for _ in range(3):
        for key in varmap:
            varmap[key] = _resolve(varmap[key], varmap)
    return varmap


def _resolve(text, varmap):
    # Plain $V and ${V} only; ${V-op...} expansions keep their
    # literal text (fail closed). Single-quote imprecision is
    # fail-closed: resolving a literal can only add markers.
    def sub(m):
        name = m.group(2)
        if name not in varmap:
            return m.group(0)
        if m.group(1):
            if not m.group(3):
                return m.group(0)
            return varmap[name]
        if m.group(3):
            return varmap[name] + "}"
        return varmap[name]
    return re.sub(r"\$(\{)?([A-Za-z_][A-Za-z0-9_]*)(\})?",
                  sub, text)


def _audit_line(line, drift):
    cleaned, inners = extract_subshells(line)
    for inner in inners:
        _audit_line(inner, drift)
    for tgt in redirect_targets(cleaned):
        if is_trusted_write_target(tgt) \
                and "helper-trusted-write" not in drift:
            drift.append("helper-trusted-write")
        if _is_home_write(tgt) \
                and "helper-home-write" not in drift:
            drift.append("helper-home-write")
    nosub = re.sub(r"[A-Za-z_][A-Za-z0-9_]*\(\)\s*\{?", "",
                   cleaned)
    nosub = _strip_case_patterns(nosub)
    for piece, _, _ in split_commands2(nosub):
        words = [unquote(t) for t in tokenize(piece)]
        if not words:
            continue
        argv0, rest = peel_prefix(words)
        if not argv0 or argv0 in SHELL_KEYWORDS \
                or argv0 in ("for", "select", "case"):
            continue
        if re.match(r"^[\*\?\[]", argv0) \
                or re.match(r"^\d*[<>]", argv0):
            continue
        pre = words[:len(words) - len(rest) - 1]
        _check_poison_assign(pre, argv0, rest, drift)
        _check_command(argv0, list(rest), list(pre), drift)


def audit_helpers(ctx, drift):
    raw = "\n".join(ctx.code_lines)
    invoked = set(re.findall(
        r"\$\{SCRIPT_DIR\}/([\w][\w.-]*\.sh)", raw))
    compact = re.sub(r"\s+", "", raw)
    invoked.update(re.findall(
        r"steps\.scriptdir\.outputs\.dir\}\}/"
        r"([\w][\w.-]*\.sh)", compact))
    invoked.add("lib.sh")
    # test.sh is deliberately out of scope: only the tokenless
    # selftest executes it, and trusted-tree-changed still gates
    # its changes for human review.
    for name in sorted(invoked):
        try:
            with open(".github/scripts/muse-review/"
                      + name) as fh:
                raw = fh.read().splitlines()
        except OSError:
            continue
        varmap = _collect_vars(raw)
        for line in logical_lines(_strip_heredocs(raw)):
            _audit_line(_resolve(line, varmap), drift)


def audit_trusted_changed(drift):
    if os.environ.get("TRUSTED_CHANGED") == "true" \
            and "trusted-tree-changed" not in drift:
        drift.append("trusted-tree-changed")
