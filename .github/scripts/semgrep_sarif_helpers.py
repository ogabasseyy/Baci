"""Token-bearing helper guards: every script the review executes
inherits runner tokens, so invoked helpers (plus lib.sh, which
they all source) must contain no indirection into the attacker
tree, no privilege change, and no writes into protected trees.
Directly hostile code is indistinguishable from legitimate token
use, so any trusted-tree change also fails for human review.
"""
import os
import re
from semgrep_sarif_defer import (_mapfile_callback,
                                  _trap_handler)
from semgrep_sarif_heredoc import _strip_heredocs
from semgrep_sarif_interp import _check_command
from semgrep_sarif_pins import _is_home_write
from semgrep_sarif_poison import _base as _varname
from semgrep_sarif_poison import _check_poison_assign
from semgrep_sarif_scan import (arith_regions, extract_subshells,
                                redirect_targets,
                                subscript_cmdsubst, _write_zone)
from semgrep_sarif_shell import (ENV_POISON, SHELL_KEYWORDS,
                                 logical_lines, peel_prefix,
                                 split_commands2, tokenize,
                                 unquote)

DEFERRED_RE = re.compile(
    r"(?:^|[;&|])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*"
    r"(?:(?:export|local|readonly|declare|typeset)\s+"
    r"(?:-\S+\s+)*)?"
    r"(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*"
    r"(PS4|PROMPT_COMMAND)\s*="
    r"|(?:^|[;&|])\s*printf\s+(?:--\s+)?-v\s*"
    r"(PS4|PROMPT_COMMAND)\b")
XTRACE_RE = re.compile(
    r"\bset\s+-[A-Za-z]*x|\bset\s+-o\s+xtrace\b"
    r"|\b(?:bash|sh)\s+-[A-Za-z]*x")
_POISON_ALT = "(?:" + "|".join(
    v for v in ENV_POISON if v != "IFS") + ")"
BARE_POISON_RE = re.compile(
    r"(?:^|[;&|])\s*" + _POISON_ALT + r"\s*=[^=]"
    r"|(?:^|[;&|])\s*IFS\s*=(?![^;\s]*\s+"
    r"(?:command\s+|builtin\s+)?read\b)[^=]")
# Helpers authenticate gh via the environment (never expanding
# the token: the sole legit mention is run.sh's -u scrub), so
# any $GH_TOKEN/$GITHUB_TOKEN expansion stages a secret into a
# log, file, or agent input. \b keeps GH_TOKEN_SUFFIX silent.
SECRET_EXPAND_RE = re.compile(
    r"\$\{[#!]?GH_TOKEN\b|\$GH_TOKEN\b"
    r"|\$\{[#!]?GITHUB_TOKEN\b|\$GITHUB_TOKEN\b")


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


def _collect_vars(raw_lines):
    # Last top-level literal assignment per name (bash last-
    # wins), so ${install_dir}/... resolves before path checks
    # while a SCRIPT_DIR alias reassigned to the workspace
    # resolves to the workspace at use. An unresolvable last
    # assignment deletes the entry: keeping the earlier literal
    # would resolve dynamic content to a stale trusted-looking
    # value. Conditional/indented assigns never resolve.
    carry = "(?:" + "|".join(CARRY_VARS) + ")"
    varmap = {}
    for line in raw_lines:
        m = re.match(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)"
                     r"=(.*)$", line)
        if not m:
            continue
        name = m.group(1)
        val = m.group(2).strip()
        if len(val) >= 2 and val[0] == val[-1] \
                and val[0] in ("'", '"'):
            inner = val[1:-1]
        elif re.fullmatch(r"\S+", val or " "):
            inner = val
        else:
            varmap.pop(name, None)
            continue
        if "`" in inner or "$(" in inner:
            varmap.pop(name, None)
            continue
        scrubbed = re.sub(r"\$(?:\{" + carry + r"\}|" + carry
                           + r")", "", inner)
        if "$" in scrubbed:
            varmap.pop(name, None)
            continue
        varmap[name] = inner
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


def _audit_expansions(line, drift, src=""):
    # Unquoted-heredoc-body audit: words are stdin data (never
    # commands), but expansions execute. Extracted commands
    # audit fully; arithmetic regions for nested $/backtick.
    # Per-line (never joined): a $((...)) split across bodies
    # cannot fuse with another body's text into a phantom.
    _, inners = extract_subshells(line)
    for inner in inners:
        _audit_line(inner, drift, src)
    if any("$" in body or "`" in body
           for body in arith_regions(line)) \
            and "helper-arithmetic-sub" not in drift:
        drift.append("helper-arithmetic-sub")


def _strip_redirects(words):
    # Drop redirect ops (+ glued/next-word targets) so rests
    # hold only operands. Zone checks read line-level targets.
    redir = re.compile(r"^\d*(>>|>&|>|<<<|<<|<>|<&|<)")
    kept, j = [], 0
    while j < len(words):
        m = redir.match(words[j])
        if m:
            j += 1 if len(words[j]) > m.end() else 2
        else:
            kept.append(words[j])
            j += 1
    return kept


def _audit_line(line, drift, src=""):
    cleaned, inners = extract_subshells(line)
    for inner in inners:
        _audit_line(inner, drift, src)
    for inner in subscript_cmdsubst(line):
        _audit_line(inner, drift, src)
    if DEFERRED_RE.search(line) \
            and "helper-deferred-exec" not in drift:
        drift.append("helper-deferred-exec")
    nosq = re.sub(r"'[^']*'", "''", cleaned)
    if XTRACE_RE.search(nosq) \
            and "helper-xtrace" not in drift:
        drift.append("helper-xtrace")
    # Arithmetic scans the raw line: extraction above rewrites $(( as
    # $( and would blind this rule to its own construct.
    if any("$" in body or "`" in body
           for body in arith_regions(line)) \
            and "helper-arithmetic-sub" not in drift:
        drift.append("helper-arithmetic-sub")
    if BARE_POISON_RE.search(line) \
            and "helper-env-poison" not in drift:
        drift.append("helper-env-poison")
    if SECRET_EXPAND_RE.search(line) \
            and "helper-secret-expand" not in drift:
        drift.append("helper-secret-expand")
    for tgt in redirect_targets(cleaned):
        zone = _write_zone(tgt)
        if zone == "trusted" \
                and "helper-trusted-write" not in drift:
            drift.append("helper-trusted-write")
        if zone == "workspace" \
                and "helper-workspace-write" not in drift:
            drift.append("helper-workspace-write")
        if _is_home_write(tgt) \
                and "helper-home-write" not in drift:
            drift.append("helper-home-write")
    nosub = re.sub(r"[A-Za-z_][A-Za-z0-9_]*\(\)\s*\{?", "",
                   cleaned)
    nosub = _strip_case_patterns(nosub)
    for piece, _, _ in split_commands2(nosub):
        words = [unquote(t) for t in tokenize(piece)]
        words = _strip_redirects(words)
        if not words:
            continue
        argv0, rest = peel_prefix(words)
        if not argv0:
            continue
        if argv0 in ("for", "select"):
            # Loop variables assign: a poison name rebinds
            # the environment for every later command.
            # (Checked before the keyword skip: both words
            # are in SHELL_KEYWORDS.)
            if rest and _varname(rest[0]) in ENV_POISON \
                    and "helper-env-poison" not in drift:
                drift.append("helper-env-poison")
            continue
        if argv0 in SHELL_KEYWORDS or argv0 == "case":
            continue
        if argv0 == "trap":
            handler = _trap_handler(rest)
            if handler is not None:
                _audit_line(handler, drift, src)
        elif argv0 in ("mapfile", "readarray"):
            cb = _mapfile_callback(rest)
            if cb is not None:
                _audit_line(cb, drift, src)
        if re.match(r"^[\*\?\[]", argv0) \
                or re.match(r"^\d*[<>]", argv0):
            continue
        pre = words[:len(words) - len(rest) - 1]
        _check_poison_assign(pre, argv0, rest, drift)
        _check_command(argv0, list(rest), list(pre), drift,
                       src)


def _audit_shell_file(path, drift):
    try:
        with open(path) as fh:
            raw = fh.read().splitlines()
    except OSError:
        drift.append("helper-unreadable")
        return
    varmap = _collect_vars(raw)
    src = os.path.basename(path)
    code, bodies = _strip_heredocs(raw)
    for line in logical_lines(code):
        _audit_line(_resolve(line, varmap), drift, src)
    for line in bodies:
        _audit_expansions(_resolve(line, varmap), drift, src)


def invoked_shell_refs(raw):
    # .sh names the workflow routes via ${SCRIPT_DIR} (plus lib.sh,
    # sourced by every helper): referenced-but-missing drifts.
    invoked = set(re.findall(
        r"\$\{SCRIPT_DIR\}/([\w][\w.-]*\.sh)", raw))
    compact = re.sub(r"\s+", "", raw)
    invoked.update(re.findall(
        r"steps\.scriptdir\.outputs\.dir\}\}/"
        r"([\w][\w.-]*\.sh)", compact))
    invoked.add("lib.sh")
    return invoked


def audit_trusted_changed(drift):
    if os.environ.get("TRUSTED_CHANGED") == "true" \
            and "trusted-tree-changed" not in drift:
        drift.append("trusted-tree-changed")
