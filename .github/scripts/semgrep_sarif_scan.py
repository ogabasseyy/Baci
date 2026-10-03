"""Quote/paren-aware shell scanners: subshell extraction,
brace skipping, and output-redirect targets with the trusted-
tree write predicate shared by run-block and helper audits.
"""
import posixpath
import re
from semgrep_sarif_shell import (_bare_word, _peel_exec_opts,
                                 split_commands2, tokenize)


def _paren_end(text, i):
    # Index of the paren closing the depth opened before i, or
    # len(text) when unterminated. Single quotes are literal,
    # double quotes nest for paren purposes, backslashes skip.
    depth, quote, j = 1, None, i
    while j < len(text) and depth:
        ch = text[j]
        if quote == "'":
            if ch == "'":
                quote = None
            j += 1
        elif ch == "\\" and j + 1 < len(text):
            j += 2
        elif ch == "'":
            quote = "'"
            j += 1
        elif ch == '"':
            quote = None if quote == '"' else '"'
            j += 1
        elif ch == "(":
            depth += 1
            j += 1
        elif ch == ")":
            depth -= 1
            j += 1
        else:
            j += 1
    return j - 1 if depth == 0 else len(text)

def skip_braced(text, i):
    # Index just past the ${...} opening at i (i points at $),
    # honoring nesting and quotes. Unterminated runs to end.
    depth, j, quote = 1, i + 2, None
    while j < len(text) and depth:
        ch = text[j]
        if quote == "'":
            if ch == "'":
                quote = None
            j += 1
        elif ch == "\\" and j + 1 < len(text):
            j += 2
        elif ch == "'":
            quote = "'"
            j += 1
        elif ch == '"':
            quote = None if quote == '"' else '"'
            j += 1
        elif ch == "{":
            depth += 1
            j += 1
        elif ch == "}":
            depth -= 1
            j += 1
        else:
            j += 1
    return j

def extract_subshells(text):
    # Split out $(...), `...`, <(...) and >(...) commands for
    # separate analysis, replacing each with inert $(). Nested
    # forms recurse; single quotes are literal but double
    # quotes scan through (substitutions execute inside them);
    # ${...} scans through (no commands of its own, but may
    # nest $()); $((...)) extracts the same way (its nested
    # $() operands still execute).
    out, inners = [], []
    i, quote = 0, None
    while i < len(text):
        ch = text[i]
        if quote == "'":
            out.append(ch)
            if ch == "'":
                quote = None
            i += 1
        elif ch == "\\" and i + 1 < len(text):
            out.append(ch)
            out.append(text[i + 1])
            i += 2
        elif ch == "'":
            quote = "'"
            out.append(ch)
            i += 1
        elif ch == '"':
            quote = None if quote == '"' else '"'
            out.append(ch)
            i += 1
        elif ch == "`":
            j = i + 1
            buf = []
            while j < len(text) and text[j] != "`":
                if text[j] == "\\" and j + 1 < len(text):
                    buf.append(text[j])
                    buf.append(text[j + 1])
                    j += 2
                else:
                    buf.append(text[j])
                    j += 1
            inner, sub = extract_subshells("".join(buf))
            inners.append(inner)
            inners.extend(sub)
            out.append("$()")
            i = j + 1
        elif ch == "$" and text[i:i + 2] == "$(":
            j = _paren_end(text, i + 2)
            inner, sub = extract_subshells(text[i + 2:j])
            inners.append(inner)
            inners.extend(sub)
            out.append("$()")
            i = j + 1 if j < len(text) else j
        elif ch in ("<", ">") and text[i:i + 2] in ("<(", ">("):
            j = _paren_end(text, i + 2)
            inner, sub = extract_subshells(text[i + 2:j])
            inners.append(inner)
            inners.extend(sub)
            out.append("$()")
            i = j + 1 if j < len(text) else j
        else:
            out.append(ch)
            i += 1
    return "".join(out), inners

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
    # Returns inner commands.
    inners = []
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

def arith_regions(text):
    # Bodies of $((...)) expansions. Arithmetic evaluates nested
    # expansions even inside single quotes (verified: PWNED), so a
    # $ or backtick in here is executable despite quote stripping.
    regions = []
    i, quote = 0, None
    while i < len(text):
        ch = text[i]
        if quote == "'":
            if ch == "'":
                quote = None
            i += 1
        elif ch == "\\" and i + 1 < len(text):
            i += 2
        elif ch == "'":
            quote, i = "'", i + 1
        elif ch == '"' or ch == "`":
            i += 1
        elif text[i:i + 3] == "$((":
            j = _paren_end(text, i + 2)
            regions.append(text[i + 3:j - 1]
                           if j < len(text) else text[i + 3:])
            i = j + 1 if j < len(text) else j
        else:
            i += 1
    return regions


def arith_command_regions(text):
    # Bodies of ((...)) compound commands ($((...)) excluded:
    # arith_regions covers those). Bare names here recurse
    # exactly like $((...)), so the opaque-name rule applies;
    # quoted spans are literal text, never commands, and are
    # skipped. Residual: [[ ]]/case globs with (( over-match.
    regions = []
    i, quote, n = 0, None, len(text)
    while i < n:
        ch = text[i]
        if quote:
            if ch == quote:
                quote = None
            i += 1
        elif ch in ("'", '"'):
            quote, i = ch, i + 1
        elif ch == "\\" and i + 1 < n:
            i += 2
        elif text[i:i + 2] == "((" \
                and (i == 0 or text[i - 1] != "$"):
            j = _paren_end(text, i + 1)
            regions.append(text[i + 2:j - 1]
                           if j < len(text) else text[i + 2:])
            i = j + 1 if j < len(text) else j
        else:
            i += 1
    return regions


def github_cmdfile_kind(target):
    # "env"/"path" when a redirect/copy target is a runner
    # command file ($GITHUB_ENV/$GITHUB_PATH, braced or bare;
    # :-style defaults still land in the file when the var is
    # set, which runners always do). GITHUB_ENVY and friends
    # fail the boundary.
    t = target.strip().strip("\"'")
    m = re.fullmatch(r"\$(GITHUB_(ENV|PATH))", t)
    if m:
        return m.group(2).lower()
    m = re.fullmatch(r"\$\{GITHUB_(ENV|PATH)([^}]*)\}", t)
    if m and (m.group(2) == ""
              or m.group(2)[0] in ":}-+=?#%/["):
        return m.group(1).lower()
    return None


def is_trusted_write_target(target):
    # The trusted tree is never legitimately written by audited
    # code: resolver and helpers only read it (writes go to
    # GITHUB_OUTPUT/GITHUB_PATH/RUNNER_TEMP). Either spelling of
    # the tree root in a redirect target drifts.
    return "trusted-scripts" in target or re.search(
        r"\$(\{)?SCRIPT_DIR\}?", target) is not None

MUSE_BIN_RE = (r"^(?:\$(?:\{HOME\}|HOME)/|~/)"
               r"\.local/bin/muse$")
MUSE_DIR_RE = (r"^(?:\$(?:\{HOME\}|HOME)|~)"
               r"(?:/\.local(?:/bin)?)?/?$")
WS_RE = r"^\$(?:\{GITHUB_WORKSPACE\}|GITHUB_WORKSPACE)(?:/|$)"


def _collapse_proc_root(path):
    # Resolve /proc/<pid>/root symlinks lexically (each is the
    # process root /), alternating with normpath the way the
    # kernel resolves left to right. Pids exclude leading dots
    # (/proc/../root is root's home, not an alias). Bounded;
    # non-converging spellings stay for the caller's match.
    for _ in range(8):
        path = posixpath.normpath(re.sub(
            r"^/proc/[^/.][^/]*/root(?=/|$)", "", path,
            count=1) or "/")
    return path


def has_proc_environ(text):
    # Any /proc path resolving to an environ file: direct,
    # dot-dot, or /root-aliased spellings (/proc/self/root/
    # /proc/self/environ reads our own secrets). Step secrets
    # past exact-value masking, whatever the reader.
    for m in re.finditer(
            r"(?:^|[^/\w])(/proc/\S*?/environ(?![\w]))", text):
        if re.fullmatch(r"/proc/[^/]+/environ",
                        _collapse_proc_root(m.group(1))):
            return True
    return False


def _write_zone(target):
    # Where a helper write lands: "trusted" (script tree, the
    # installed muse binary, or its ancestor dirs -- a link
    # swap there redirects the absolute-path invocation),
    # "workspace" (the agent-readable checkout: token staging),
    # or None. Collapsed (/proc/<pid>/root aliases) and
    # normalized first so .. and alias spellings cannot hide a
    # protected destination (over-approximating outward escapes
    # is fail-closed).
    t = _collapse_proc_root(target)
    if "trusted-scripts" in t or re.search(
            r"\$(\{)?SCRIPT_DIR\}?", t) is not None:
        return "trusted"
    if re.match(MUSE_BIN_RE, t) or re.match(MUSE_DIR_RE, t):
        return "trusted"
    if re.match(WS_RE, t):
        return "workspace"
    return None

