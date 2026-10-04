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
from semgrep_sarif_poison import (_check_poison_assign,
                                 audit_promptfile_rebind)
from semgrep_sarif_cmdfile import (audit_github_cmdfile_body,
                                   audit_github_cmdfile_writes)
from semgrep_sarif_redirect import (has_socket_redirect,
                                    redirect_targets)
from semgrep_sarif_scan import (arith_command_regions,
                                arith_regions,
                                blank_arith_commands,
                                extract_subshells,
                                _strip_case_patterns)
from semgrep_sarif_subscript import subscript_cmdsubst
from semgrep_sarif_zone import _write_zone, has_proc_environ
from semgrep_sarif_segments import logical_lines
from semgrep_sarif_consts import (BARE_POISON_RE, DEFERRED_RE,
                                  ENV_POISON, INDIRECT_RE,
                                  SECRET_EXPAND_RE, SHELL_KEYWORDS,
                                  XTRACE_RE)
from semgrep_sarif_peel import peel_prefix
from semgrep_sarif_shell import (_bare_word, split_commands2,
                                 tokenize)
from semgrep_sarif_varmap import (_collect_vars, _resolve,
                                  audit_unresolved_argv)


def _audit_expansions(line, drift, src="", stale=frozenset(),
                      opaque=frozenset()):
    # Unquoted-heredoc-body audit: words are stdin data (never
    # commands), but expansions execute. Extracted commands
    # audit fully; arithmetic regions for nested $/backtick.
    # Per-line (never joined): a $((...)) split across bodies
    # cannot fuse with another body's text into a phantom.
    _, inners = extract_subshells(line)
    for inner in inners:
        _audit_line(inner, drift, src, stale, opaque)
    if any("$" in body or "`" in body
           for body in arith_regions(line)) \
            or _arith_opaque_hit(line, opaque):
        if "helper-arithmetic-sub" not in drift:
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


def _arith_opaque_hit(line, opaque):
    # Bare opaque names in arithmetic: bash re-evaluates the
    # value as an expression, so a crafted subscript shape
    # (arr[$(...)]) executes (verified on bash 3.2 and 5.1).
    # $((...)) bodies scan whole; ((...)) bodies strip $(...)
    # spans first (single-expansion output, audited where the
    # substitution sits; its own re-parse is a residual saved
    # in practice by the $(wc ...) numeric idiom).
    if not opaque:
        return False
    for body in arith_regions(line):
        if any(w in opaque
               for w in re.findall(r"[A-Za-z_]\w*", body)):
            return True
    for body in arith_command_regions(line):
        stripped, _ = extract_subshells(body)
        if any(w in opaque
               for w in re.findall(r"[A-Za-z_]\w*", stripped)):
            return True
    return False


def _audit_line(line, drift, src="", stale=frozenset(),
                opaque=frozenset()):
    cleaned, inners = extract_subshells(line)
    for inner in inners:
        _audit_line(inner, drift, src, stale, opaque)
    for inner in subscript_cmdsubst(line):
        _audit_line(inner, drift, src, stale, opaque)
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
            or _arith_opaque_hit(line, opaque):
        if "helper-arithmetic-sub" not in drift:
            drift.append("helper-arithmetic-sub")
    if BARE_POISON_RE.search(line) \
            and "helper-env-poison" not in drift:
        drift.append("helper-env-poison")
    # prompt_file feeds the agent's --prompt-file and
    # review_file publishes the agent output post.sh acts on:
    # the only binding for each is its pinned RUNNER_TEMP path
    # (both the assignment and its GITHUB_OUTPUT echo carry
    # it, the echo via the pinned variable). A constructed
    # value (/proc/environ via printf -v, a workspace path)
    # would place attacker bytes in the model prompt or the
    # posted verdict, so any other value drifts -- as does a
    # for/select bind of the name (no = text).
    for var, pinned, problem in (
            ("prompt_file", "${RUNNER_TEMP}/muse-prompt.md",
             "helper-promptfile-rebind"),
            ("review_file", "${RUNNER_TEMP}/muse-review-body.md",
             "helper-reviewfile-rebind")):
        for m in re.finditer(
                r"%s\+?=\s*(?:\"([^\"]*)\"|'([^']*)'|"
                r"([^\s\"']+))" % var, line):
            val = m.group(1) if m.group(1) is not None else (
                m.group(2) if m.group(2) is not None else
                m.group(3))
            if val not in (pinned, "${%s}" % var, "$%s" % var) \
                    and problem not in drift:
                drift.append(problem)
        if re.search(r"\b(?:for|select)\s+%s\b" % var, line) \
                and problem not in drift:
            drift.append(problem)
    if SECRET_EXPAND_RE.search(nosq) \
            and "helper-secret-expand" not in drift:
        drift.append("helper-secret-expand")
    # Process-environment reads (/proc/<pid>/environ, any pid
    # spelling, dot-dot or /root-aliased): the step's secrets
    # encoded to the log, past exact-value masking -- whatever
    # the transform (base64, xxd, cat). Quoting is no defense
    # (cat reads quoted paths), so echoing the bare path
    # over-approximates; no legit helper does (comments strip
    # before this runs).
    if has_proc_environ(cleaned) \
            and "helper-env-dump" not in drift:
        drift.append("helper-env-dump")
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
        if zone == "glob" \
                and "helper-unzoneable-write" not in drift:
            drift.append("helper-unzoneable-write")
        if _is_home_write(tgt) \
                and "helper-home-write" not in drift:
            drift.append("helper-home-write")
    if has_socket_redirect(cleaned) \
            and "helper-network-tool" not in drift:
        drift.append("helper-network-tool")
    nosub = re.sub(r"[A-Za-z_][A-Za-z0-9_]*\(\)\s*\{?", "",
                   cleaned)
    nosub = _strip_case_patterns(nosub)
    nosub = blank_arith_commands(nosub)
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
                _audit_line(handler, drift, src, stale, opaque)
        elif argv0 in ("mapfile", "readarray"):
            cb = _mapfile_callback(rest)
            if cb is not None:
                _audit_line(cb, drift, src, stale, opaque)
        if re.match(r"^[\*\?\[]", argv0) \
                or re.match(r"^\d*[<>]", argv0):
            continue
        pre = words[:len(words) - len(rest) - 1]
        audit_github_cmdfile_writes(line, drift)
        _check_poison_assign(pre, argv0, rest, drift)
        audit_promptfile_rebind(argv0, rest, drift)
        _check_command(argv0, list(rest), list(pre), drift,
                       src)
