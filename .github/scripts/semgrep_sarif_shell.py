"""Bash/YAML parsing primitives for the SARIF drift audit.

Stdlib only. Quote-aware operator splitting, argv0 peeling with
timeout/builtin/keyword transparency, interpreter operand
validation, and run:-block extraction with continuation joining.
"""
import re
from semgrep_sarif_pins import _contained_exec_path

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
        if quote:
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
              "PAGER", "GH_HOST")
# GIT_CONFIG_COUNT gates GIT_CONFIG_KEY_n/VALUE_n (verified: count 0
# ignores keys), so the COUNT exact-match closes the family.

def split_commands2(text):
    # Quote-aware operator split. Yields (piece,
    # started_after_open, ended_at_close) so `a)` case patterns
    # (not after `(`) are distinguishable from `(cmd)` bodies.
    parts = []
    buf, quote = "", None
    started_after_open = False
    for ch in text:
        if quote:
            buf += ch
            if ch == quote:
                quote = None
        elif ch in ("'", '"'):
            quote, buf = ch, buf + ch
        elif ch in ";|&()":
            parts.append((buf, started_after_open, ch == ")"))
            buf = ""
            started_after_open = (ch == "(")
        else:
            buf += ch
    parts.append((buf, started_after_open, False))
    return parts

def tokenize(text):
    return re.findall(r"\"[^\"\n]*\"|'[^'\n]*'|\S+", text)

def logical_lines(raw_lines):
    # Join quote-continued lines (a multi-line string's prose
    # must not parse as commands), then comment-strip, then
    # join backslash continuations. A # outside quotes ends
    # code for quote-tracking, matching strip_comments.
    chunks = []
    buf, quote = "", None
    for raw in raw_lines:
        if buf:
            buf += "\n"
        buf += raw
        i = 0
        while i < len(raw):
            ch = raw[i]
            if quote == "'":
                if ch == "'":
                    quote = None
            elif quote == '"':
                if ch == "\\":
                    i += 1
                elif ch == '"':
                    quote = None
            elif ch == "\\":
                i += 1
            elif ch == "#":
                break
            elif ch in ("'", '"'):
                quote = ch
            i += 1
        if quote is None:
            chunks.append(buf)
            buf = ""
    if buf.strip():
        chunks.append(buf)
    logical = []
    buf = ""
    for chunk in chunks:
        # A backslash-newline inside single quotes is literal
        # in bash; collapsing it can only split tokens, never
        # merge them, so analysis stays conservative.
        code = strip_comments(chunk.replace("\\\n", " ")).rstrip()
        if code.endswith("\\"):
            buf += code[:-1] + " "
        else:
            buf += code
            logical.append(buf)
            buf = ""
    if buf.strip():
        logical.append(buf)
    return logical


def unquote(token):
    if len(token) >= 2 and token[0] == token[-1] \
            and token[0] in ("'", '"'):
        return token[1:-1]
    return token

def peel_prefix(words):
    # Strip VAR= assigns, timeout + duration, transparent
    # builtins and control keywords; returns (argv0, rest).
    i = 0
    timeout_args = {"-s", "--signal", "-k", "--kill-after"}
    while i < len(words):
        word = words[i]
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=\S*",
                        word):
            i += 1
        elif word == "timeout":
            i += 1
            while i < len(words) \
                    and words[i].startswith("-"):
                i += 2 if words[i] in timeout_args else 1
            i += 1
        elif word in ("command", "builtin", "exec",
                     "sudo", "doas"):
            i += 1
        elif word in STRIP_WORDS:
            i += 1
        else:
            break
    if i >= len(words):
        return "", []
    return words[i], words[i + 1:]

def script_operand(rest):
    # Validate an interpreter's script operand. Returns True
    # when bound (or provably non-executing), False on drift.
    # --version/--help/-n exit or never execute: safe with any
    # operand. -c/--command drifts (arbitrary code, review it).
    # -s/stdin/no-operand drifts (uninspectable script).
    query = {"--version", "--help", "-n", "--noexec"}
    if any(t in query for t in rest):
        return True
    redir = re.compile(r"^\d*(>>|>|<<|<<<|<|>&|<&)")
    i = 0
    while i < len(rest):
        tok = rest[i]
        m = redir.match(tok)
        if m:
            i += 1 if len(tok) > m.end() else 2
        elif tok == "--":
            i += 1
            break
        elif tok == "-" or tok in ("-c", "--command",
                                   "--init-file", "--rcfile"):
            return False
        elif re.fullmatch(r"[+-][a-zA-Z]+", tok):
            if "c" in tok:
                return False
            if "s" in tok:
                return False
            if tok in ("-o", "+o") \
                    or re.fullmatch(r"[+-][a-zA-Z]*o", tok):
                i += 2
            else:
                i += 1
        elif tok.startswith("--"):
            i += 1
        else:
            break
    if i >= len(rest):
        return False
    op = rest[i]
    if re.match(r"^\$\{?SCRIPT_DIR\}?/", op):
        return _contained_exec_path(
            op, r"^\$\{?SCRIPT_DIR\}?/")
    # Concatenated so the raw text never holds an expression
    # opener, which actionlint would parse as this job's
    # expression (steps.scriptdir is undefined here).
    squashed = re.sub(r"\s+", "", op)
    anchor = "${{steps.scriptdir.outputs.dir}}"
    if squashed == anchor:
        return True
    if squashed.startswith(anchor + "/"):
        return _contained_exec_path(
            squashed, r"^\$\{\{steps\.scriptdir\.outputs\.dir\}\}/")
    return False

def run_segments(lines):
    bodies = []
    i = 0
    while i < len(lines):
        # Quoted "run": keys open blocks too: a bare-key match
        # would leave the whole step unaudited. Unnamed inline
        # steps (- run: evil) are unwrapped the same way.
        base = len(lines[i]) - len(lines[i].lstrip(" "))
        text = lines[i].strip()
        dash = re.match(r"^-\s+(.*)$", text)
        if dash:
            text = dash.group(1).strip()
        key, rest = map_key_value(text)
        ind = re.match(r"^([|>]?)\s*(.*)$", rest or "") \
            if key == "run" else None
        if ind and (ind.group(1) or ind.group(2)):
            if ind.group(1):
                j = i + 1
                while j < len(lines) \
                        and (not lines[j].strip()
                             or len(lines[j])
                             - len(lines[j].lstrip()) > base):
                    bodies.append(lines[j])
                    j += 1
                i = j
            else:
                bodies.append(ind.group(2))
                i += 1
        else:
            i += 1
    joined = []
    buf = ""
    for raw in bodies:
        stripped = raw.rstrip()
        if stripped.endswith("\\"):
            buf += stripped[:-1] + " "
        else:
            buf += stripped
            joined.append(buf)
            buf = ""
    return joined
