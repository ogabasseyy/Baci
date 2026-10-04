"""Secret-binding allowlist for workflow steps: every NAME whose
value carries a secrets.KEY interpolation must be an expected
pair (tighter for the agent step), so a fresh LEAK binding
plus an allowed echo cannot print keys in fragments.
"""
import re
from semgrep_sarif_consts import (AGENT_SECRET_BINDINGS,
                                  SECRET_BINDINGS)
from semgrep_sarif_shell import map_key_value, unquote_value

_EXPR = re.compile(r"\$\{\{(.*?)\}\}")
_DOT = re.compile(r"secrets\s*\.\s*([A-Za-z_]\w*)")
_BRACKET = re.compile(r"secrets\s*\[\s*['\"]([A-Za-z_]\w*)"
                      r"['\"]\s*\]")
_DYNAMIC = re.compile(r"secrets\s*\[(?!\s*['\"])")
_WHOLE = re.compile(r"toJSON\s*\(\s*(?:github|secrets)\s*\)",
                    re.IGNORECASE)
_OPS = ("==", "!=", "&&", "||", ">", "<")
_IDENT = r"[A-Za-z_]\w*"


def _booleanized(span):
    # True when the interpolation is an expression context
    # (comparison/logic over the secret) rather than a string
    # carrying it: string literals stripped first so a '>'
    # inside quotes cannot misclassify.
    code = re.sub(r"\"(?:[^\"\\]|\\.)*\"", "\"\"", span)
    code = re.sub(r"'[^']*'", "''", code)
    if any(op in code for op in _OPS):
        return True
    return re.search(r"![^=]", code) is not None


def _record(bound, drift, idx, agent_idx, name, key):
    bound.setdefault(name, key)
    allow = AGENT_SECRET_BINDINGS if idx in agent_idx \
        else SECRET_BINDINGS
    if (name, key) not in allow \
            and "secret-step-unexpected-binding" not in drift:
        drift.append("secret-step-unexpected-binding")


def _bindings_in_value(bound, drift, idx, agent_idx, name, value):
    # Every secrets ref carried by one mapping value: dot and
    # quoted-bracket keys bind (unless booleanized), dynamic
    # keys and whole-object toJSON bind unconditionally (no
    # allowlistable key).
    for span in _EXPR.findall(value or ""):
        if _DYNAMIC.search(span) or _WHOLE.search(span):
            _record(bound, drift, idx, agent_idx, name, "")
            continue
        if _booleanized(span):
            continue
        for key in _DOT.findall(span) + _BRACKET.findall(span):
            _record(bound, drift, idx, agent_idx, name, key)


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
