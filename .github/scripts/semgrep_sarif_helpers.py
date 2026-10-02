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
from semgrep_sarif_cmdfile import (audit_github_cmdfile_body,
                                   audit_github_cmdfile_writes)
from semgrep_sarif_redirect import (has_socket_redirect,
                                    redirect_targets)
from semgrep_sarif_scan import (arith_regions, extract_subshells,
                                subscript_cmdsubst, _write_zone)
from semgrep_sarif_segments import logical_lines
from semgrep_sarif_shell import (ENV_POISON, SHELL_KEYWORDS,
                                 _bare_word, peel_prefix,
                                 split_commands2, tokenize)
from semgrep_sarif_varmap import (_collect_vars, _resolve,
                                  audit_unresolved_argv)

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
# Bare ${!name} indirects to a caller-chosen variable (value!);
# [@]/[*] subscripts and !prefix* globs list names only.
INDIRECT_RE = re.compile(
    r"\$\{![A-Za-z_]\w*(\[(?![@*]\])[^]]*\])?\}")


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


def _audit_expansions(line, drift, src="", stale=frozenset()):
    # Unquoted-heredoc-body audit: words are stdin data (never
    # commands), but expansions execute. Extracted commands
    # audit fully; arithmetic regions for nested $/backtick.
    # Per-line (never joined): a $((...)) split across bodies
    # cannot fuse with another body's text into a phantom.
    _, inners = extract_subshells(line)
    for inner in inners:
        _audit_line(inner, drift, src, stale)
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


def _audit_line(line, drift, src="", stale=frozenset()):
    cleaned, inners = extract_subshells(line)
    for inner in inners:
        _audit_line(inner, drift, src, stale)
    for inner in subscript_cmdsubst(line):
        _audit_line(inner, drift, src, stale)
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
    if SECRET_EXPAND_RE.search(nosq) \
            and "helper-secret-expand" not in drift:
        drift.append("helper-secret-expand")
    if INDIRECT_RE.search(nosq) \
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
    if has_socket_redirect(cleaned) \
            and "helper-network-tool" not in drift:
        drift.append("helper-network-tool")
    nosub = re.sub(r"[A-Za-z_][A-Za-z0-9_]*\(\)\s*\{?", "",
                   cleaned)
    nosub = _strip_case_patterns(nosub)
    # The splitter breaks &&/|| inside [[ ]], so operands
    # surface as phantom argv0s; [[ ]] executes nothing, so the
    # unresolved rule sleeps there. Markers come from raw
    # tokens: a quoted "[[" is data, not a conditional.
    in_test = False
    prev = ""
    for piece, after_open, _ in split_commands2(nosub):
        # Array/assign parens hold data (MUSE_SEEN+=(...)),
        # never commands; a bare ( ... ) subshell still
        # executes, so only an =/+= before the ( sleeps the
        # unresolved rule. ==/!=/<=/>= are comparisons.
        paren_data = after_open and re.search(
            r"(\+=|(?<![=!<>+])=)\s*$", prev)
        prev = piece
        raw_words = tokenize(piece)
        if "[[" in raw_words:
            in_test = True
        words = [_bare_word(t) for t in raw_words]
        words = _strip_redirects(words)
        if not words:
            if "]]" in raw_words:
                in_test = False
            continue
        argv0, rest = peel_prefix(words)
        if not argv0:
            if "]]" in raw_words:
                in_test = False
            continue
        if not in_test and not paren_data:
            audit_unresolved_argv(argv0, stale, drift)
        if "]]" in raw_words:
            in_test = False
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
                _audit_line(handler, drift, src, stale)
        elif argv0 in ("mapfile", "readarray"):
            cb = _mapfile_callback(rest)
            if cb is not None:
                _audit_line(cb, drift, src, stale)
        if re.match(r"^[\*\?\[]", argv0) \
                or re.match(r"^\d*[<>]", argv0):
            continue
        pre = words[:len(words) - len(rest) - 1]
        audit_github_cmdfile_writes(line, drift)
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
    varmap, stale, namerefs = _collect_vars(raw)
    src = os.path.basename(path)
    code, bodies, env_bodies = _strip_heredocs(raw)
    for line in logical_lines(code):
        _audit_line(_resolve(line, varmap, namerefs), drift,
                    src, stale)
    for line in bodies:
        _audit_expansions(_resolve(line, varmap, namerefs),
                           drift, src, stale)
    for kind, quoted, line in env_bodies:
        audit_github_cmdfile_body(
            kind, _resolve(line, varmap, namerefs), drift,
            quoted)


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
