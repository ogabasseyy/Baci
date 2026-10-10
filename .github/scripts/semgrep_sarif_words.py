"""Quote-glued shell-word helpers shared by the agent, runner,
and copy audits: word splitting, dequoting, env-prefix
peeling, and operand/flag-value extraction.
"""
import re

from semgrep_sarif_scan import _paren_end


_DECL =  r"(?:export|declare|local|readonly|typeset)\s+"


def _arith_safe_value(inner, varmap):
    # Provably numeric-or-inert in arithmetic re-evaluation:
    # no $/backtick at all (literals, integers), whole-value
    # command output (the $(wc ...) counter idiom), status/
    # count specials, positional params ($N callers are
    # trusted in-file code passing literals/counters --
    # verified at every cap call site), length expansions, or
    # a lone reference to a varmap name whose own value is
    # inert (one level; deeper chains stay opaque).
    # Residuals: $(cat evil), and an opaque var passed as a
    # function arg into arithmetic (no call graph).
    if "`" not in inner and "$" not in inner:
        return True
    if re.fullmatch(r"\$\(.*\)", inner) is not None \
            or re.fullmatch(r"`[^`]*`", inner) is not None \
            or re.fullmatch(r"\$[?#$!-]", inner) is not None \
            or re.fullmatch(r"\$[0-9]", inner) is not None \
            or re.fullmatch(r"\$\{#[^}]*\}", inner) is not None:
        return True
    m = re.fullmatch(r"\$(?:\{([A-Za-z_]\w*)\}"
                     r"|([A-Za-z_]\w*))", inner)
    if m:
        tgt = m.group(1) or m.group(2)
        return tgt in varmap \
            and "$" not in varmap[tgt] \
            and "`" not in varmap[tgt]
    return False


def _assign_inner(val):
    # Dequoted rvalue of a bind; None when multi-word
    # unquoted. $(...) spans blank first: they are single
    # words in assignment context despite inner spaces
    # (x=$((i + 1)) unquoted is one numeric bind).
    val = val.strip()
    if len(val) >= 2 and val[0] == val[-1] \
            and val[0] in ("'", '"'):
        return val[1:-1]
    if re.fullmatch(r"\S+", val or " "):
        return val
    masked, i = [], 0
    while i < len(val):
        if val[i:i + 2] == "$(":
            j = _paren_end(val, i + 2)
            masked.append("$()")
            i = j + 1 if j < len(val) else j
        elif val[i] == "`":
            j = val.find("`", i + 1)
            masked.append("$()")
            i = j + 1 if j != -1 else len(val)
        else:
            masked.append(val[i])
            i += 1
    if re.fullmatch(r"\S+", "".join(masked)):
        return val
    return None




def _shell_words(text):
    # Shell words: whitespace splits outside quotes, quotes group
    # (glued quotes stay one word: "a/"b is a/b, not two tokens).
    words, buf, quote = [], "", None
    i = 0
    while i < len(text):
        ch = text[i]
        if quote == "'":
            buf += ch
            if ch == "'":
                quote = None
            i += 1
        elif quote == '"' and ch == "\\" and i + 1 < len(text):
            buf += text[i:i + 2]
            i += 2
        elif quote == '"' and ch == '"':
            buf, quote, i = buf + ch, None, i + 1
        elif quote:
            buf, i = buf + ch, i + 1
        elif ch in ("'", '"'):
            quote, buf, i = ch, buf + ch, i + 1
        elif ch in (" ", "\t", "\n"):
            if buf:
                words.append(buf)
                buf = ""
            i += 1
        elif ch == "\\" and i + 1 < len(text):
            buf += text[i:i + 2]
            i += 2
        else:
            buf, i = buf + ch, i + 1
    if buf:
        words.append(buf)
    return words


def _dequote(word):
    # Remove quote characters (backslash-aware): glued forms
    # collapse to the executed spelling ("a/"b -> a/b).
    out, quote, i = "", None, 0
    while i < len(word):
        ch = word[i]
        if quote == "'":
            if ch == "'":
                quote = None
            else:
                out += ch
            i += 1
        elif ch == "\\" and quote != "'" and i + 1 < len(word):
            out += word[i + 1]
            i += 2
        elif quote == '"' and ch == '"':
            quote, i = None, i + 1
        elif not quote and ch in ("'", '"'):
            quote, i = ch, i + 1
        else:
            out, i = out + ch, i + 1
    return out


def _peel_env(words):
    # See through env -u/-i/VAR= prefixes to the real argv0 (the
    # runner scrubs tokens via env -u, so muse sits behind env).
    assign = re.compile(
        r"^([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]*\])?(\+)?=")
    i = 0
    while i < len(words):
        word = _dequote(words[i])
        m = assign.match(word)
        if m:
            # Assigns (plain, subscript, and += alike) prefix
            # commands (verified: a[0]=x and v+=x both ran
            # the command on bash 3.2), so all peel through.
            i += 1
        elif word != "env":
            break
        else:
            i += 1
            while i < len(words):
                tok = _dequote(words[i])
                if tok == "--":
                    i += 1
                    break
                if tok in ("-u", "-C", "--unset", "--chdir",
                           "--argv0"):
                    i += 2
                elif tok in ("-i", "-0", "--null", "-v",
                             "--ignore-environment"):
                    i += 1
                elif re.fullmatch(r"-[a-zA-Z0-9]+", tok):
                    i += 2 if tok[-1] in "uC" else 1
                elif tok.startswith("--") and "=" in tok:
                    i += 1
                elif re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*",
                                  tok):
                    i += 1
                else:
                    break
    return words[i:]


def _operands(rest):
    ops, done = [], False
    for tok in rest:
        if not done and tok == "--":
            done = True
        elif not done and tok.startswith("-") and len(tok) > 1:
            continue
        else:
            ops.append(tok)
    return ops


def _tool_operands(rest, shorts, longs):
    # Positional operands with per-tool flag values skipped:
    # separate (-s 2), =-attached (--skip-chars=2), and
    # short-glued (-s2) forms. -- ends flag parsing; a lone
    # - is an operand (stdin marker).
    ops, i, n = [], 0, len(rest)
    while i < n:
        tok = rest[i]
        if tok == "--":
            return ops + rest[i + 1:]
        if tok.startswith("--"):
            name = tok.split("=", 1)[0]
            if "=" in tok or name not in longs:
                i += 1
            else:
                i += 2
            continue
        if tok.startswith("-") and len(tok) > 1:
            j = 1
            while j < len(tok):
                if tok[j] in shorts:
                    if j + 1 == len(tok):
                        i += 1
                    break
                j += 1
            i += 1
            continue
        ops.append(tok)
        i += 1
    return ops


def _flag_value(rest, names):
    i = 0
    while i < len(rest):
        tok = rest[i]
        if tok == "--":
            return None
        if tok in names and i + 1 < len(rest):
            return rest[i + 1]
        for name in names:
            if tok.startswith(name + "="):
                return tok.split("=", 1)[1]
        i += 1
    return None

def _single_pipe(seg):
    code = re.sub(r"\"(?:[^\"\\]|\\.)*\"", "\"\"", seg)
    code = re.sub(r"'[^']*'", "''", code)
    return re.search(r"(?<!\|)\|(?!\|)", code) is not None


def _later_value(piece, start):
    # One shell word from start: quotes pair, $(...) nests,
    # so spaced values (then x=$((i + 1))) extract whole.
    buf, i, n = [], start, len(piece)
    quote = None
    while i < n:
        ch = piece[i]
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
            i += 1
        elif ch in ("'", '"'):
            quote = ch
            buf.append(ch)
            i += 1
        elif piece[i:i + 2] == "$(":
            j = _paren_end(piece, i + 2)
            end = j + 1 if j < n else n
            buf.append(piece[i:end])
            i = end
        elif ch == "`":
            j = piece.find("`", i + 1)
            end = j + 1 if j != -1 else n
            buf.append(piece[i:end])
            i = end
        elif ch in (" ", "\t", ";", "&", "|"):
            break
        else:
            buf.append(ch)
            i += 1
    return "".join(buf)


def _pop_later_assigns(piece, varmap, stale, opaque):
    # Multi-assign remainder (export A=x B=y): values cannot be
    # attributed past the first, so every later name pops
    # stale. The opaque set is value-aware -- numeric-safe
    # values no-op (local _f="$1" _n=0), anything else, and
    # always +=, adds.
    rest = re.sub(r"^\s*(?:" + _DECL + r")?[A-Za-z_]\w*\s*"
                  r"\+?=(?![=~])", "", piece, count=1)
    for m in re.finditer(r"(?:^|[\s;&])([A-Za-z_]\w*)\s*"
                         r"(\+)?=(?![=~])", rest):
        varmap.pop(m.group(1), None)
        stale.add(m.group(1))
        if m.group(2):
            opaque.add(m.group(1))
            continue
        inner = _assign_inner(_later_value(rest, m.end()))
        if inner is None \
                or not _arith_safe_value(inner, varmap):
            opaque.add(m.group(1))

