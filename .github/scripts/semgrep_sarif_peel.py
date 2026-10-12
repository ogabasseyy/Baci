"""Command-prefix peeling: VAR= assigns, timeout, wrappers
(exec/command/builtin/time/sudo), and control keywords, with
safe-path basename matching for absolute wrapper spellings.
"""
import re
from semgrep_sarif_consts import STRIP_WORDS
from semgrep_sarif_pins import _safe_exec_path


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

_TIME_VALUE_OPTS = {"-o", "--output", "-f", "--format"}


def _peel_time_opts(words, i):
    # Index of time's command past its options (GNU time
    # consumes options first; -o/-f take attached-or-next
    # values, --output=/--format= glue theirs). Unknown
    # options skip (a value-taking future flag then audits
    # its value as the command: over-approx, fail-closed).
    # -- terminates options; --version/--help print and run
    # nothing, so skipping them to an empty rest is exact.
    while i < len(words):
        tok = words[i]
        if tok == "--":
            return i + 1
        if tok in _TIME_VALUE_OPTS:
            i += 2
        elif tok.startswith(("--output=", "--format=")):
            i += 1
        elif tok.startswith("--"):
            i += 1
        elif re.fullmatch(r"-[a-zA-Z]+", tok):
            at = next((k for k, ch in enumerate(tok[1:])
                       if ch in "of"), -1)
            i += 2 if at == len(tok) - 2 else 1
        else:
            return i
    return i


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
    # -- terminators, time -o/-f/--output/--format) and
    # control keywords; returns
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
            i = _peel_time_opts(words, i + 1)
        elif key in ("sudo", "doas"):
            i += 1
        elif word in STRIP_WORDS:
            i += 1
        else:
            break
    if i >= len(words):
        return "", []
    return words[i], words[i + 1:]
