"""Bash parsing primitives for the SARIF drift audit.

Quote-aware operator splitting, word tokenizing
with concatenation, bare-word normalization (quotes/escapes),
and argv0 peeling with timeout/wrapper/keyword transparency.
(YAML/run:-block extraction lives in semgrep_sarif_segments.)
"""
import re
from semgrep_sarif_pins import _safe_exec_path

def strip_comments(line):
    # Backslash-aware: an escaped hash is literal (echo \#; evil
    # still executes the suffix), so only an unescaped # outside
    # quotes starts a comment. Quote branches match bash (no
    # escapes in single quotes; \# stays two chars in doubles).
    buf = []
    quote = None
    i, n = 0, len(line)
    while i < n:
        ch = line[i]
        if quote == '"' and ch == "\\" and i + 1 < n:
            buf.append(line[i:i + 2])
            i += 2
        elif quote:
            buf.append(ch)
            if ch == quote:
                quote = None
            i += 1
        elif ch in ("'", '"'):
            quote = ch
            buf.append(ch)
            i += 1
        elif ch == "\\" and i + 1 < n:
            buf.append(line[i:i + 2])
            i += 2
        elif ch == "#":
            break
        else:
            buf.append(ch)
            i += 1
    return "".join(buf)


_YAML_DOUBLE_ESCAPES = {
    "0": "\0", "a": "\a", "b": "\b", "t": "\t", "n": "\n",
    "v": "\v", "f": "\f", "r": "\r", "e": "\x1b", " ": " ",
    '"': '"', "\\": "\\", "N": "\u0085", "_": "\u00a0",
    "L": "\u2028", "P": "\u2029",
}


def _yaml_double_unescape(text):
    # Decode YAML double-quoted escape sequences (\uXXXX,
    # \UXXXXXXXX, \xXX, \n, \", \\, ...): the runner's YAML
    # parser resolves "\u0075ses" to uses, so key/value
    # classification must see the decoded scalar or encoded
    # checkouts evade the ref count. Escape-free text is
    # returned unchanged; unknown/invalid escapes pass
    # through literally (invalid YAML fails CI anyway).
    out, i = [], 0
    while i < len(text):
        ch = text[i]
        if ch != "\\" or i + 1 >= len(text):
            out.append(ch)
            i += 1
            continue
        nxt = text[i + 1]
        if nxt in _YAML_DOUBLE_ESCAPES:
            out.append(_YAML_DOUBLE_ESCAPES[nxt])
            i += 2
        elif nxt in ("x", "u", "U"):
            width = {"x": 2, "u": 4, "U": 8}[nxt]
            digits = text[i + 2:i + 2 + width]
            if len(digits) == width:
                try:
                    out.append(chr(int(digits, 16)))
                    i += 2 + width
                    continue
                except ValueError:
                    pass
            out.append(text[i:i + 2])
            i += 2
        else:
            out.append(text[i:i + 2])
            i += 2
    return "".join(out)


def map_key_value(stripped):
    # Split a stripped YAML mapping line into (key, value) with
    # quoted keys normalized ("uses": -> uses) and YAML escapes
    # decoded ("\u0075ses": -> uses, 'it''s' -> it's). Single/
    # double quotes only; exotic spellings (anchors, tags, ?
    # keys) yield None so callers fall through to their
    # fail-closed path.
    m = re.match(r"""^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|"""
                 r"""([A-Za-z_][A-Za-z0-9_.-]*))\s*:\s*(.*)$""",
                 stripped)
    if not m:
        return None, None
    if m.group(1):
        key = _yaml_double_unescape(m.group(1))
    elif m.group(2):
        key = m.group(2).replace("''", "'")
    else:
        key = m.group(3)
    return key, m.group(4)


def unquote_value(value):
    # Strip one matching quote pair (uses: "actions/..." is valid
    # YAML) and decode YAML escapes inside it ("a\u0075b" is
    # really aub to the runner); anything else passes through
    # to exact comparison (plain scalars decode nothing).
    text = value.strip()
    if len(text) >= 2 and text[0] == text[-1] \
            and text[0] in ("'", '"'):
        inner = text[1:-1]
        if text[0] == '"':
            return _yaml_double_unescape(inner)
        return inner.replace("''", "'")
    return text


# Shared shell parsing for the consumer checks below.
# Residual: -c payloads (drift, needs human review), URLs/paths
# assembled from variables, read/getopts/printf -v rebindings.
# Peeled (transparent) leading words; `for/select/case` pieces
# are skipped outright (word lists, not commands).

def split_commands2(text):
    # Quote-aware operator split. Yields (piece,
    # started_after_open, ended_at_close) so `a)` case patterns
    # (not after `(`) are distinguishable from `(cmd)` bodies.
    # Backslash escapes track inside double quotes (\" never
    # closes, or a phantom quote swallows the ; separator).
    parts = []
    buf, quote = "", None
    started_after_open = False
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if quote == '"' and ch == "\\" and i + 1 < n:
            buf += text[i:i + 2]
            i += 2
        elif quote:
            buf += ch
            if ch == quote:
                quote = None
            i += 1
        elif ch in ("'", '"'):
            quote, buf, i = ch, buf + ch, i + 1
        elif ch in ";|&()":
            parts.append((buf, started_after_open, ch == ")"))
            buf = ""
            started_after_open = (ch == "(")
            i += 1
        else:
            buf += ch
            i += 1
    parts.append((buf, started_after_open, False))
    return parts

def tokenize(text):
    # Shell words: split on unquoted whitespace only. Quotes
    # group (adjacent parts concatenate: "ec""ho" is one word),
    # backslash escapes the next char (a\ b stays one word, a
    # backslash-newline joins, \" never closes inside doubles),
    # and operators are NOT split (the command splitter and
    # redirect strippers own those).
    words, buf = [], ""
    quote, started, i = None, False, 0
    while i < len(text):
        ch = text[i]
        if quote == '"' and ch == "\\" and i + 1 < len(text):
            buf += text[i:i + 2]
            started = True
            i += 2
        elif quote:
            buf += ch
            if ch == quote:
                quote = None
            i += 1
        elif ch == "\\" and i + 1 < len(text):
            if text[i + 1] == "\n":
                i += 2
            else:
                buf += text[i:i + 2]
                started = True
                i += 2
        elif ch in ("'", '"'):
            quote, buf, started = ch, buf + ch, True
            i += 1
        elif ch in (" ", "\t", "\n", "\r", "\f", "\v"):
            if started:
                words.append(buf)
                buf, started = "", False
            i += 1
        else:
            buf, started, i = buf + ch, True, i + 1
    if started:
        words.append(buf)
    return words

def unquote(token):
    if len(token) >= 2 and token[0] == token[-1] \
            and token[0] in ("'", '"'):
        return token[1:-1]
    return token

_ANSI_SIMPLE = {"a": "\a", "b": "\b", "e": "\x1b",
                "E": "\x1b", "f": "\f", "n": "\n",
                "r": "\r", "t": "\t", "v": "\v",
                "\\": "\\", "'": "'", '"': '"', "?": "?"}


def _decode_ansi_c(token, i):
    # Decode one $'...' body starting past the quote; returns
    # (value, index past the closing quote, or end). Octal,
    # hex, unicode, and control escapes per the bash manual;
    # an unknown escape degrades to its letter ($'\q' is q).
    # Never raises (modulo the code-point ceiling): hostile
    # input must drift, never crash the audit.
    out, n = [], len(token)
    while i < n:
        ch = token[i]
        if ch == "'":
            return "".join(out), i + 1
        if ch != "\\" or i + 1 >= n:
            out.append(ch)
            i += 1
            continue
        e = token[i + 1]
        if e in _ANSI_SIMPLE:
            out.append(_ANSI_SIMPLE[e])
            i += 2
        elif re.match(r"[0-7]", e):
            m = re.match(r"[0-7]{1,3}", token[i + 1:])
            out.append(chr(int(m.group(0), 8) % 256))
            i += 1 + len(m.group(0))
        elif re.match(r"[xuU]", e):
            width = {"x": 2, "u": 4, "U": 8}[e]
            m = re.match(r"[0-9a-fA-F]{1,%d}" % width,
                         token[i + 2:])
            if m:
                out.append(chr(int(m.group(0), 16)
                               % 0x110000))
                i += 2 + len(m.group(0))
            else:
                out.append(e)
                i += 2
        elif e == "c" and i + 2 < n:
            out.append(chr(ord(token[i + 2].upper()) & 0x1F))
            i += 3
        else:
            out.append(e)
            i += 2
    return "".join(out), i


def _bare_word(token):
    # Bash word value: strip quotes, unescape backslashes
    # (single quotes literal -- same profile as _dequote in
    # runner.py). Dollar-prefixed quoting decodes ($'ba''sh'
    # executes bash; $".." follows double-quote rules).
    # Escaped externals still execute (ba\sh runs bash), so
    # dispatch and denylists match the bare spelling; escaped
    # builtins/keywords/assigns are dead (verified), so
    # bare-matching them over-approximates safely.
    out, quote, i = "", None, 0
    while i < len(token):
        ch = token[i]
        if quote == "'":
            if ch == "'":
                quote = None
            else:
                out += ch
            i += 1
        elif ch == "\\" and quote != "'" and i + 1 < len(token):
            out += token[i + 1]
            i += 2
        elif quote == '"' and ch == '"':
            quote, i = None, i + 1
        elif not quote and ch == "$" and i + 1 < len(token) \
                and token[i + 1] in ("'", '"'):
            if token[i + 1] == "'":
                decoded, i = _decode_ansi_c(token, i + 2)
                out += decoded
            else:
                quote, i = '"', i + 2
        elif not quote and ch in ("'", '"'):
            quote, i = ch, i + 1
        else:
            out, i = out + ch, i + 1
    return out
