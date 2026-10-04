"""Perl code/comment partition: a lexer, not the shell
stripper (which mis-split q(#) and hid trailing calls).
Quote-like ops (q/qq/qx/qw/qr/m/s/y/tr, paired or plain
delims), strings, regexes, and $# are skipped; / and ? open
a match in operand state (after operators/keywords) and
divide otherwise. Comment text is ALSO scanned for
dangerous call shapes, so a misclassification cannot
silence a real call -- with prose carve-outs (backtick
quotes, do-prose, $ENV mentions, lowercase use/no without
a semicolon read as prose). Residual: =pod/format/heredoc
bodies and __END__ content scan as code (fail closed);
bare // or ?...? after an unknown word (custom function
taking a regex) mis-split; ?pat? is deprecated anyway.
"""
import re
from semgrep_sarif_programs import (_open_danger,
                                    audit_perl_content)

_PAIRS = {"(": ")", "[": "]", "{": "}", "<": ">"}
_OPS = ("qq", "qx", "qw", "qr", "tr", "q", "m", "s", "y")
_TWO_PART = {"s", "y", "tr"}
# Words after which / or ? opens a match (operand state).
_OPERAND_WORDS = {"return", "print", "say", "printf", "sprintf",
                  "if", "unless", "while", "until", "for",
                  "foreach", "given", "when", "and", "or",
                  "not", "xor", "split", "grep", "map", "sort",
                  "die", "warn"}
_OP_CHARS = set("=!&|+-*%.^~:<>")
# Lowercase pragmas that still drift in comments (any other
# lowercase use/no word without a semicolon reads as prose).
_PRAGMAS = {"lib", "constant", "autouse", "feature",
            "experimental", "open", "if", "re", "mro", "ops",
            "encoding", "threads", "forks", "version",
            "parent", "base"}


def _skip_paired(line, j):
    # j at opener; past the paired closer (nesting-aware).
    close = _PAIRS[line[j]]
    i, n, depth = j + 1, len(line), 1
    while i < n and depth:
        if line[i] == "\\" and i + 1 < n:
            i += 2
        elif line[i] == line[j]:
            depth += 1
            i += 1
        elif line[i] == close:
            depth -= 1
            i += 1
        else:
            i += 1
    return i


def _skip_to(line, j, delim):
    i, n = j, len(line)
    while i < n and line[i] != delim:
        i += 2 if line[i] == "\\" and i + 1 < n else 1
    return i + 1 if i < n else n


def _skip_flags(line, i):
    while i < len(line) and "a" <= line[i] <= "z":
        i += 1
    return i


def _skip_regex(line, j):
    # j past the opening / or ?; char classes may hold it.
    opener = line[j - 1]
    i, n, in_class = j, len(line), False
    while i < n:
        if line[i] == "\\" and i + 1 < n:
            i += 2
        elif line[i] == "[" and not in_class:
            in_class = True
            i += 1
        elif line[i] == "]" and in_class:
            in_class = False
            i += 1
        elif line[i] == opener and not in_class:
            i += 1
            break
        else:
            i += 1
    return _skip_flags(line, i)


def _perl_op(line, i):
    # (op, delim_idx) when a quote-like op starts at word
    # start i; None for words, variables, and fat commas
    # ({s => 1} is a hash, not a substitution).
    if i and (line[i - 1].isalnum() or line[i - 1] == "_"
              or line[i - 1] in "$@%&*"):
        return None
    if i >= 2 and line[i - 1] == "{" and line[i - 2] == "$":
        return None
    for op in _OPS:
        if not line.startswith(op, i):
            continue
        j = i + len(op)
        while j < len(line) and line[j] in " \t":
            j += 1
        if line[j:j + 2] == "=>":
            return None
        if j >= len(line) or line[j].isalnum() \
                or line[j] in "_ \t":
            return None
        return op, j
    return None


def _skip_op(line, j, op):
    # j at delim; past the op (s/y/tr take two parts; a
    # bracketed first part followed by ; , ) ] } or EOL is
    # a call -- s($x) -- not a substitution).
    n = len(line)
    if line[j] in _PAIRS:
        i = _skip_paired(line, j)
        if op in _TWO_PART:
            k = i
            while k < n and line[k] in " \t":
                k += 1
            if k < n and line[k] in _PAIRS:
                i = _skip_paired(line, k)
            elif k >= n or line[k] in ";,)]}#":
                pass
            else:
                i = _skip_to(line, k + 1, line[k])
    else:
        i = _skip_to(line, j + 1, line[j])
        if op in _TWO_PART:
            i = _skip_to(line, i, line[j])
    if op in ("s", "y", "tr", "m", "qr"):
        i = _skip_flags(line, i)
    return i


def split_perl_line(line):
    # (code, comment): the state machine; comment keeps its
    # # and is "" when no comment opener is found.
    i, n = 0, len(line)
    operand = True
    while i < n:
        ch = line[i]
        if ch == "#":
            return line[:i], line[i:]
        if ch in " \t":
            i += 1
        elif ch in "\"'`":
            i = _skip_to(line, i + 1, ch)
            operand = False
        elif ch == "\\":
            i += 2
        elif ch == "/" and line[i:i + 2] == "//":
            i += 2
            operand = True
        elif ch == "/" and line[i + 1:i + 2] == "=":
            i += 2
            operand = True
        elif ch == "/":
            if operand:
                i = _skip_regex(line, i + 1)
                operand = False
            else:
                i += 1
                operand = True
        elif ch == "?":
            if operand:
                i = _skip_regex(line, i + 1)
                operand = False
            else:
                i += 1
                operand = True
        elif ch in _OP_CHARS or ch in ",;([{":
            i += 1
            operand = True
        elif ch in ")]}":
            i += 1
            operand = False
        elif ch == "$" and line[i:i + 2] == "$#":
            i += 2
            operand = False
        elif ch in "$@%":
            i += 1
            if i < n and line[i] == "{":
                i = _skip_paired(line, i)
            elif i < n and (line[i].isalnum()
                            or line[i] == "_"):
                while i < n and (line[i].isalnum()
                                 or line[i] == "_"):
                    i += 1
            elif i < n and line[i] in "^!":
                i += 1
            operand = False
        elif ch.isalpha() or ch == "_":
            j = i
            while j < n and (line[j].isalnum()
                             or line[j] == "_"):
                j += 1
            found = _perl_op(line, i)
            if found is not None:
                i = _skip_op(line, found[1], found[0])
                operand = False
            elif line[i:j] in _OPERAND_WORDS:
                i = j
                operand = True
            else:
                i = j
                operand = False
        elif ch.isdigit():
            while i < n and (line[i].isalnum()
                             or line[i] in "_."):
                i += 1
            operand = False
        else:
            i += 1
    return line, ""


_COMMENT_CALL = re.compile(
    r"(?<![\w$:])\b(system|exec|eval|readpipe)\s*[\(\"']"
    r"|(?<![\w$:])\bqx\s*[^A-Za-z0-9_\s]"
    r"|(?<![\w$>:\-%@*])(socketpair|getsockopt|setsockopt"
    r"|shutdown|socket|connect|bind|listen|accept|syscall"
    r"|fcntl|ioctl)\s*\("
    r"|(?<!\$)\brequire\b(?!\s+v?[\d][\d._]*\s*(?:[;}]|$))"
    r"|\bdo\s+[\"']")


def _mod_shape(comment, m, mod):
    # Module-shaped (X::Y, Uppercase, known pragma) or
    # semicolon-terminated: commented code, not prose.
    return "::" in mod or mod[0].isupper() \
        or mod in _PRAGMAS \
        or re.match(r"\s*;", comment[m.end():])


def audit_perl_comment(comment, drift):
    # Comment call shapes: process spawning, qx, socket
    # builtins, and file loading with call syntax drift;
    # use/no drift only for module shapes (X::Y, Uppercase,
    # known pragma, or a trailing semicolon) so "# use of
    # force" and "# no warnings here" read as prose.
    if "helper-perl-danger" in drift:
        return
    if _COMMENT_CALL.search(comment) \
            or _open_danger(comment):
        drift.append("helper-perl-danger")
        return
    for m in re.finditer(
            r"(?<![\$>:])\buse\s+([A-Za-z_][\w:.]*)", comment):
        mod = m.group(1)
        if re.match(r"v?\d", mod) \
                or mod in ("strict", "warnings"):
            continue
        if _mod_shape(comment, m, mod):
            drift.append("helper-perl-danger")
            return
    for m in re.finditer(
            r"(?<![\$>:])\bno\s+([A-Za-z_][\w:.]*)", comment):
        mod = m.group(1)
        # No strict/warnings exemption here: `no strict`
        # disables safety (the code rule exempts versions
        # only).
        if re.match(r"v?\d", mod):
            continue
        if _mod_shape(comment, m, mod):
            drift.append("helper-perl-danger")
            return


def audit_perl_file(text, drift):
    code, comments = [], []
    for line in text.splitlines():
        kept, noted = split_perl_line(line)
        code.append(kept)
        if noted:
            comments.append(noted)
    audit_perl_content("\n".join(code), drift)
    for noted in comments:
        audit_perl_comment(noted, drift)
