"""Single-quoted subscript extraction: builtins that reparse
variable names (test/[ -v, printf -v, declare-family, unset,
read, let) evaluate subscripts the main extractor treats as
literal. Returns the inner commands for recursive audit.
"""
import re
from semgrep_sarif_peel import _peel_exec_opts
from semgrep_sarif_scan import _paren_end, extract_subshells
from semgrep_sarif_shell import (_bare_word, split_commands2,
                                 tokenize)


_NAME_PEEL = {"if", "then", "else", "elif", "while",
              "until", "do", "{", "}", "!", "time", "command",
              "builtin"}
# for/select/case/function pieces hold word lists or
# definitions, never invocations, so they are not peeled.
_ASSIGN_PREFIX_RE = re.compile(r"^[A-Za-z_]\w*"
                               r"(\[[^\]]*\])?(\+)?=")
_READ_VALUED = set("dinNptu")


def _peel_name_pieces(bare):
    # Index of the builtin past keyword/wrapper/assign
    # prefixes (a[0]=x and v+=x prefix commands too:
    # verified PREFIX-RAN/PLUS-RAN on bash 3.2).
    j = 0
    while j < len(bare):
        w = bare[j]
        if w in _NAME_PEEL:
            j += 1
            if w in ("command", "time") \
                    and bare[j:j + 1] == ["-p"]:
                j += 1
        elif w == "exec":
            j = _peel_exec_opts(bare, j + 1)
        elif _ASSIGN_PREFIX_RE.match(w):
            j += 1
        else:
            break
    return j


def _skip_op_flags(bare, raw, valued, plus):
    # Operands past --/flags: short clusters, valued letters
    # consuming the word rest or the next word (read -p'..').
    # +words are flags only for declare-family (read/unset
    # reject them, so scanning past them fails closed).
    i = 0
    while i < len(bare):
        w = bare[i]
        if w == "--":
            return raw[i + 1:]
        if len(w) > 1 and w[0] == "-":
            k = 1
            while k < len(w):
                if w[k] in valued:
                    if k + 1 == len(w):
                        i += 1
                    break
                k += 1
            i += 1
        elif plus and len(w) > 1 and w[0] == "+":
            i += 1
        else:
            return raw[i:]
    return []


def _name_operands(argv0, bare, raw):
    # Raw operand words holding variable names whose
    # subscripts bash evaluates. printf honors -v only
    # first (verified: later -v words print literally).
    if argv0 in ("test", "["):
        idx = [i for i, w in enumerate(bare)
               if w == "-v" and (i == 0 or (i == 1
                                            and bare[0] == "!"))]
        return [raw[i + 1] for i in idx
                if i + 1 < len(raw)]
    if argv0 == "printf":
        if bare[:1] == ["-v"] and len(raw) > 1:
            return [raw[1]]
        return []
    if argv0 in ("declare", "local", "typeset", "readonly"):
        return _skip_op_flags(bare, raw, set(), True)
    if argv0 == "unset":
        return _skip_op_flags(bare, raw, set(), False)
    if argv0 == "read":
        return _skip_op_flags(bare, raw, _READ_VALUED, False)
    if argv0 == "let":
        return list(raw)
    return []


def _operand_lhs(operand):
    # Text before the first = outside $(...)/backticks: the
    # declare value never evaluates (declare -i 'x=$(..)'
    # is a syntax-error-no-exec on bash 3.2, as is let
    # 'x=$(..)'), so only the name/subscript side scans.
    j = 0
    while j < len(operand):
        if operand[j] == "$" and operand[j:j + 2] == "$(":
            j = _paren_end(operand, j + 2) + 1
        elif operand[j] == "`":
            k = operand.find("`", j + 1)
            j = len(operand) if k < 0 else k + 1
        elif operand[j] == "\\" and j + 1 < len(operand):
            j += 2
        elif operand[j] == "=":
            return operand[:j]
        else:
            j += 1
    return operand


def _subscript_spans(lhs):
    # Contents of name[...] regions: subscripts expand as
    # words (command substitution executes) before their
    # arithmetic evaluation (verified on bash 3.2).
    spans = []
    for m in re.finditer(r"[A-Za-z_]\w*\[", lhs):
        j, depth = m.end(), 1
        while j < len(lhs) and depth:
            if lhs[j] == "$" and lhs[j:j + 2] == "$(":
                j = _paren_end(lhs, j + 2) + 1
            elif lhs[j] == "`":
                k = lhs.find("`", j + 1)
                j = len(lhs) if k < 0 else k + 1
            elif lhs[j] == "\\" and j + 1 < len(lhs):
                j += 2
            elif lhs[j] == "[":
                depth += 1
                j += 1
            elif lhs[j] == "]":
                depth -= 1
                j += 1
            else:
                j += 1
        spans.append(lhs[m.end():j - 1 if not depth else j])
    return spans


_NUM_OP = re.compile(r"-(?:eq|ne|lt|le|gt|ge)(?![A-Za-z0-9_])")


def _bracket_regions(text):
    # [[ ... ]] spans with quote pairing and backslash
    # escapes honored (a quoted or escaped ]] never closes
    # the test).
    regions, i, n = [], 0, len(text)
    while i < n:
        if not text.startswith("[[", i):
            i += 1
            continue
        j, quote, buf = i + 2, None, []
        while j < n:
            ch = text[j]
            if quote:
                buf.append(ch)
                if ch == "\\" and j + 1 < n:
                    buf.append(text[j + 1])
                    j += 2
                    continue
                if ch == quote:
                    quote = None
                j += 1
            elif ch in ("'", '"'):
                quote = ch
                buf.append(ch)
                j += 1
            elif ch == "\\" and j + 1 < n:
                buf.append(ch)
                buf.append(text[j + 1])
                j += 2
            elif text.startswith("]]", j):
                break
            else:
                buf.append(ch)
                j += 1
        regions.append("".join(buf))
        i = j + 2 if j < n else n
    return regions


def subscript_cmdsubst(text):
    # $(...) / `...` hiding in single-quoted name[..]
    # operands, which extract_subshells treats as literal.
    # [[ -v ]] plus every builtin that reparses variable
    # names (test/[ -v, printf -v, declare/local/typeset/
    # readonly, unset, read, let): declare/local/typeset/
    # read/unset/let subscripts verified executable on bash
    # 3.2, test -v on 5.x, printf -v and readonly
    # version-dependent (audited fail-closed). export never
    # takes subscripts (verified). Unquoted and double-quoted
    # forms are already covered by the main extraction.
    # [[ ]] numeric operands evaluate as arithmetic even
    # single-quoted (verified on 3.2), so quoted operands of
    # -eq/-ne/-lt/-le/-gt/-ge extract too. Returns inner
    # commands.
    inners = []
    for region in _bracket_regions(text):
        for m in _NUM_OP.finditer(region):
            cands = []
            bm = re.search(r"'([^']*)'\s*$",
                           region[:m.start()])
            if bm:
                cands.append(bm.group(1))
            am = re.match(r"\s*'([^']*)'",
                          region[m.end():])
            if am:
                cands.append(am.group(1))
            for cand in cands:
                for span in _subscript_spans(
                        _operand_lhs(cand)):
                    _, sub = extract_subshells(span)
                    inners.extend(sub)
    for m in re.finditer(r"\[\[\s+(?:!\s+)?-v\s+", text):
        j = m.end()
        while j < len(text) and text[j] in (" ", "\t"):
            j += 1
        if j >= len(text) or text[j] != "'":
            continue
        k = j + 1
        while k < len(text) and text[k] != "'":
            k += 1
        for span in _subscript_spans(
                _operand_lhs(text[j + 1:k])):
            _, sub = extract_subshells(span)
            inners.extend(sub)
    for piece, _, _ in split_commands2(text):
        words = tokenize(piece)
        if not words:
            continue
        bare = [_bare_word(w) for w in words]
        j = _peel_name_pieces(bare)
        if j >= len(bare):
            continue
        for op in _name_operands(bare[j], bare[j + 1:],
                                 words[j + 1:]):
            for span in re.findall(r"'([^']*)'", op):
                for sub2 in _subscript_spans(
                        _operand_lhs(span)):
                    _, sub = extract_subshells(sub2)
                    inners.extend(sub)
    return inners
