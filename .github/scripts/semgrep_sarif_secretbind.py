"""Secret-binding allowlist for workflow steps: every NAME whose
value carries a secrets.KEY interpolation must be an expected
pair (tighter for the agent step), so a fresh LEAK binding
plus an allowed echo cannot print keys in fragments.
"""
import re
from semgrep_sarif_consts import (AGENT_SECRET_BINDINGS,
                                  SECRET_BINDINGS)
from semgrep_sarif_shell import map_key_value, unquote_value

_EXPR = re.compile(r"\$\{\{(.*?)\}\}", re.DOTALL)
_DOT = re.compile(r"secrets\s*\.\s*([A-Za-z_]\w*)")
_BRACKET = re.compile(r"secrets\s*\[\s*['\"]([A-Za-z_]\w*)"
                      r"['\"]\s*\]")
_DYNAMIC = re.compile(r"secrets\s*\[(?!\s*['\"])")
_TOKEN = re.compile(r"github\s*\.\s*token\b",
                    re.IGNORECASE)
_TOKEN_BRACKET = re.compile(r"github\s*\[\s*['\"]token"
                            r"['\"]\s*\]", re.IGNORECASE)
_TOKEN_DYNAMIC = re.compile(r"github\s*\[(?!\s*['\"])",
                            re.IGNORECASE)
# Bracket refs after literal stripping (secrets['K'] sheds
# to secrets['']): the surviving shape proves a quoted key.
_BRACKET_LIT = re.compile(r"secrets\s*\[\s*(''|\"\")\s*\]")
_TOKEN_BRACKET_LIT = re.compile(
    r"github\s*\[\s*(''|\"\")\s*\]", re.IGNORECASE)
_WHOLE = re.compile(r"toJSON\s*\(\s*(?:github|secrets)\s*\)",
                    re.IGNORECASE)
_BOOL_FUNCS = {"contains", "startswith", "endswith",
               "success", "failure", "cancelled", "always"}
_IDENT = r"[A-Za-z_]\w*"


def _strip_literals(span):
    # String literals shed first so a '>' or secret-shaped
    # word inside quotes cannot misclassify the expression.
    code = re.sub(r"\"(?:[^\"\\]|\\.)*\"", "\"\"", span)
    return re.sub(r"'[^']*'", "''", code)


def _split_top(code, seps):
    # Split on separators at paren depth 0 (two-char ops
    # first); quotes already stripped by the caller.
    parts, buf, depth, i = [], "", 0, 0
    while i < len(code):
        ch = code[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if not depth:
            hit = next((s for s in seps
                        if code.startswith(s, i)), None)
            if hit:
                parts.append(buf)
                buf = ""
                i += len(hit)
                continue
        buf += ch
        i += 1
    parts.append(buf)
    return parts


def _carries_secret(span):
    # True when the interpolation evaluates to secret data
    # (bound value carries it) rather than a boolean over it.
    # Comparisons (!=, ==, >, <) and unary ! return booleans;
    # ||/&& return an operand's value, so any carrying side
    # carries; calls to known-boolean functions return
    # booleans, every other call (case, format, join, ...)
    # carries when any argument does. A bare secret/token
    # reference carries.
    code = _strip_literals(span).strip()
    if not code:
        return False
    if code.startswith("("):
        depth, i = 0, 0
        while i < len(code):
            depth += 1 if code[i] == "(" else 0
            depth -= 1 if code[i] == ")" else 0
            i += 1
            if not depth:
                break
        if i == len(code):
            return _carries_secret(code[1:-1])
    if len(_split_top(code, ("||", "&&"))) > 1:
        return any(_carries_secret(p)
                   for p in _split_top(code, ("||", "&&")))
    if len(_split_top(code, ("==", "!=", ">=", "<=",
                             ">", "<"))) > 1:
        return False
    if code.startswith("!"):
        return False
    m = re.fullmatch(r"([A-Za-z_]\w*)\s*\((.*)\)", code,
                     re.DOTALL)
    if m:
        if m.group(1).lower() in _BOOL_FUNCS:
            return False
        return any(_carries_secret(p)
                   for p in _split_top(m.group(2), (",",)))
    return _DOT.search(code) is not None \
        or _BRACKET_LIT.search(code) is not None \
        or _TOKEN.search(code) is not None \
        or _TOKEN_BRACKET_LIT.search(code) is not None


def _record(bound, drift, idx, agent_idx, name, key):
    bound.setdefault(name, key)
    allow = AGENT_SECRET_BINDINGS if idx in agent_idx \
        else SECRET_BINDINGS
    if (name, key) not in allow \
            and "secret-step-unexpected-binding" not in drift:
        drift.append("secret-step-unexpected-binding")


def _bindings_in_value(bound, drift, idx, agent_idx, name, value):
    # Every secrets/github.token ref carried by one mapping
    # value: dot and quoted-bracket keys bind (unless the span
    # evaluates boolean), dynamic keys and whole-object toJSON
    # bind unconditionally (no allowlistable key). The
    # github.token key cannot collide with secrets KEYs (the
    # dot is not an identifier char), so no legit binding
    # allowlists it by accident.
    for span in _EXPR.findall(value or ""):
        if _DYNAMIC.search(span) \
                or _TOKEN_DYNAMIC.search(span) \
                or _WHOLE.search(span):
            _record(bound, drift, idx, agent_idx, name, "")
            continue
        if not _carries_secret(span):
            continue
        for key in _DOT.findall(span) + _BRACKET.findall(span):
            _record(bound, drift, idx, agent_idx, name, key)
        if _TOKEN.search(span) \
                or _TOKEN_BRACKET.search(span):
            _record(bound, drift, idx, agent_idx, name,
                     "github.token")


def _flow_pairs(text):
    # Top-level name: value pairs inside a flow mapping
    # (quotes and nesting honored).
    pairs, i, n = [], 0, len(text)
    while i < n:
        m = re.match(r"\s*(?:\"([^\"]*)\"|'([^']*)'|"
                     r"([A-Za-z_][\w.-]*))\s*:", text[i:])
        if not m:
            i += 1
            continue
        name = m.group(1) or m.group(2) or m.group(3)
        j = i + m.end()
        depth, quote, val = 0, None, []
        while j < n:
            ch = text[j]
            if quote:
                val.append(ch)
                if ch == quote:
                    quote = None
            elif ch in ("'", '"'):
                quote = ch
                val.append(ch)
            elif ch in ("{", "["):
                depth += 1
                val.append(ch)
            elif ch in ("}", "]"):
                if not depth:
                    break
                depth -= 1
                val.append(ch)
            elif ch == "," and not depth:
                break
            else:
                val.append(ch)
            j += 1
        pairs.append((name, "".join(val)))
        i = j + 1
    return pairs


def _block_value(lines, i, indent, folded):
    # Block-scalar continuation: deeper-indented lines joined
    # (folded with spaces, literal with newlines).
    cont = []
    j = i + 1
    while j < len(lines):
        if lines[j].strip() == "":
            j += 1
            continue
        if len(lines[j]) - len(lines[j].lstrip(" ")) <= indent:
            break
        cont.append(lines[j].strip())
        j += 1
    join = " " if folded else "\n"
    return join.join(cont)


def collect_secret_bindings(lines, agent_idx, drift):
    # Whole-file binding scan (job-level env precedes the
    # first step boundary): block scalars resolve before
    # matching, flow pairs scan on {-lines, and agent-
    # inherited lines take the tighter allowlist. Returns
    # the NAME -> KEY map for the exfil rules.
    bound = {}
    for i, line in enumerate(lines):
        key, val = map_key_value(line.strip())
        if key and re.fullmatch(_IDENT, key):
            text = re.sub(r"\s+#.*$", "",
                          unquote_value(val or "")).strip()
            if re.fullmatch(r"[>|][+\-0-9]*", text):
                indent = len(line) - len(line.lstrip(" "))
                text = _block_value(lines, i, indent,
                                    text.startswith(">"))
            _bindings_in_value(bound, drift, i, agent_idx,
                               key, text)
        if "{" in line:
            for name, value in _flow_pairs(line):
                if re.fullmatch(_IDENT, name):
                    _bindings_in_value(bound, drift, i,
                                       agent_idx, name, value)
    return bound
