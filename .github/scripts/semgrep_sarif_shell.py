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


def map_key_value(stripped):
    # Split a stripped YAML mapping line into (key, value) with
    # quoted keys normalized ("uses": -> uses). Single/double
    # quotes only; exotic spellings (anchors, tags, ? keys) yield
    # None so callers fall through to their fail-closed path.
    m = re.match(r"""^(?:"([^"]*)"|'([^']*)'|"""
                 r"""([A-Za-z_][A-Za-z0-9_.-]*))\s*:\s*(.*)$""",
                 stripped)
    if not m:
        return None, None
    key = m.group(1) or m.group(2) or m.group(3)
    return key, m.group(4)


def unquote_value(value):
    # Strip one matching quote pair (uses: "actions/..." is valid
    # YAML); anything else passes through to exact comparison.
    text = value.strip()
    if len(text) >= 2 and text[0] == text[-1] \
            and text[0] in ("'", '"'):
        return text[1:-1]
    return text


# Shared shell parsing for the consumer checks below.
# Residual: -c payloads (drift, needs human review), URLs/paths
# assembled from variables, read/getopts/printf -v rebindings.
SHELL_KEYWORDS = {"if", "then", "else", "elif", "fi", "for",
                  "while", "until", "do", "done", "case", "in",
                  "esac", "select", "function", "time", "!",
                  "[[", "]]", "{", "}"}
# Peeled (transparent) leading words; `for/select/case` pieces
# are skipped outright (word lists, not commands).
STRIP_WORDS = {"if", "while", "until", "time", "!", "then",
               "do", "else", "elif", "{", "}"}
INTERP_ALLOW = {"bash", "sh", "source", "."}
STRICT_ALLOW = INTERP_ALLOW | {
    "set", "echo", "exit", "export", "readonly", "local",
    "declare", "typeset", "true", "false", ":", "test"}
# Vars whose assignment redirects execution or the environment
# of later commands in the same step (PATH hijack, preloaded
# libraries, startup files, parser behavior).
ENV_POISON = ("PATH", "LD_PRELOAD", "LD_LIBRARY_PATH",
              "BASH_ENV", "ENV", "ZDOTDIR", "PYTHONPATH",
              "PYTHONHOME", "RUBYLIB", "RUBYOPT", "PERL5LIB",
              "PERL5OPT", "NODE_PATH", "NODE_OPTIONS",
              "DYLD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES",
              "IFS", "GIT_SSH", "GIT_SSH_COMMAND", "GIT_PAGER",
              "GIT_EDITOR", "GIT_CONFIG_COUNT", "GIT_CONFIG_GLOBAL",
              "GIT_CONFIG_SYSTEM", "GIT_DIR", "GIT_WORK_TREE",
              "GIT_EXTERNAL_DIFF", "GIT_DIFF_OPTS", "GIT_ASKPASS",
              "GIT_CONFIG_PARAMETERS",
              "PAGER", "GH_HOST")
# GIT_CONFIG_COUNT gates GIT_CONFIG_KEY_n/VALUE_n (verified: count 0
# ignores keys), so the COUNT exact-match closes the family.

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

def _bare_word(token):
    # Bash word value: strip quotes, unescape backslashes
    # (single quotes literal -- same profile as _dequote in
    # runner.py). Escaped externals still execute (ba\sh runs
    # bash), so dispatch and denylists match the bare spelling;
    # escaped builtins/keywords/assigns are dead (verified), so
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
        elif not quote and ch in ("'", '"'):
            quote, i = ch, i + 1
        else:
            out, i = out + ch, i + 1
    return out

def _peel_exec_opts(words, j):
    # Index of exec's command past -c/-l/-a name/-- (an
    # unknown dash word is the command: exec errors on it, so
    # treating it as argv0 fails closed).
    while j < len(words):
        tok = words[j]
        if tok == "--":
            return j + 1
        m = re.fullmatch(r"-([cla]+)", tok)
        if not m:
            return j
        if "a" in m.group(1):
            rest = m.group(1).split("a", 1)[1]
            return j + 1 if rest else j + 2
        j += 1
    return j

def _peel_command_opts(words, j):
    # Index of command's command past -p/--, or None for -v/-V
    # queries (they print, never execute).
    while j < len(words):
        tok = words[j]
        if tok == "--":
            return j + 1
        if re.fullmatch(r"-[pVv]+", tok):
            if "v" in tok or "V" in tok:
                return None
            j += 1
        else:
            return j
    return j

def _peel_keyword(word):
    # Wrapper keywords match bare, or by basename behind a safe
    # exec path (/usr/bin/timeout peels exactly like timeout,
    # so its command operand audits). A slash spelling that is
    # not a safe exec path is not a wrapper: "" stops the peel
    # and the caller's path rule drifts it (./timeout sits in
    # PR-controlled cwd, so peeling it would bless evil).
    if "/" not in word:
        return word
    base = word.rsplit("/", 1)[-1]
    if base in ("timeout", "time", "exec", "command",
                "builtin", "sudo", "doas") \
            and _safe_exec_path(word):
        return base
    return ""


def peel_prefix(words):
    # Strip VAR= assigns, timeout + duration, transparent
    # wrappers (with their options: exec -a name, command -p,
    # -- terminators, time -p) and control keywords; returns
    # (argv0, rest). sudo/doas peel bare (their pre-words always
    # drift via the privilege rule). Nesting re-enters: builtin
    # exec cmd parses exec's options on the next pass.
    # Wrappers peel by basename behind safe absolute paths too
    # (/usr/bin/timeout 5s evil must audit evil, not pass as a
    # safe system executable); STRIP_WORDS stays exact-match
    # (an executable named `if` is a command, not a keyword).
    i = 0
    timeout_args = {"-s", "--signal", "-k", "--kill-after"}
    while i < len(words):
        word = words[i]
        key = _peel_keyword(word)
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=\S*",
                        word):
            i += 1
        elif key == "timeout":
            i += 1
            while i < len(words) \
                    and words[i].startswith("-"):
                i += 2 if words[i] in timeout_args else 1
            i += 1
        elif key == "exec":
            i = _peel_exec_opts(words, i + 1)
        elif key == "command":
            j = _peel_command_opts(words, i + 1)
            if j is None:
                return "", []
            i = j
        elif key == "builtin":
            i += 1
            if i < len(words) and words[i] == "--":
                i += 1
        elif key == "time":
            i += 1
            while i < len(words) and words[i] == "-p":
                i += 1
        elif key in ("sudo", "doas"):
            i += 1
        elif word in STRIP_WORDS:
            i += 1
        else:
            break
    if i >= len(words):
        return "", []
    return words[i], words[i + 1:]

