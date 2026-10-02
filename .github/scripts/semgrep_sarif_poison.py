"""Loader/startup-variable guards: direct, declaration, and
indirect (printf/read/getopts/mapfile) assignment to PATH-family
variables, plus values written to the runner command files
($GITHUB_ENV exports to later steps; $GITHUB_PATH entries
prepend to PATH). Bare export of a poison name needs no rule:
every dangerous value flows through an assignment this module
(or the bare-assign scan) already drifts.
"""
import re
from semgrep_sarif_pins import _ws_rooted
from semgrep_sarif_scan import (github_cmdfile_kind,
                                redirect_targets)
from semgrep_sarif_shell import (ENV_POISON, split_commands2,
                                 tokenize, unquote)


def _base(word):
    # Leading identifier: a[0] -> a (subscript writes still
    # bind the name); malformed names fail closed when they
    # start with a poison identifier.
    m = re.match(r"[A-Za-z_][A-Za-z0-9_]*", word)
    return m.group(0) if m else ""


def _read_names(rest):
    # Variable names read assigns: flag values skipped, -a
    # arrays count, stops at redirects.
    names, i, n = [], 0, len(rest)
    while i < n:
        tok = rest[i]
        if tok == "--":
            i += 1
            break
        if not tok.startswith("-") or len(tok) == 1 \
                or tok.startswith("--"):
            break
        j, consumed = 1, False
        while j < len(tok):
            if tok[j] in "adinNptu":
                if tok[j] == "a":
                    if j + 1 < len(tok):
                        names.append(tok[j + 1:])
                    elif i + 1 < n:
                        names.append(rest[i + 1])
                        consumed = True
                elif j + 1 >= len(tok):
                    consumed = True
                break
            j += 1
        i += 2 if consumed else 1
    while i < n:
        if re.match(r"^\d*[<>]", rest[i]):
            break
        names.append(rest[i])
        i += 1
    return names


def _mapfile_name(rest):
    # Assigned array, or "" for the default MAPFILE. -c/-C/-d/
    # -n/-O/-s/-u consume values (rest-of-token or next).
    i, n = 0, len(rest)
    while i < n:
        tok = rest[i]
        if tok == "--":
            i += 1
            break
        if not tok.startswith("-") or len(tok) == 1 \
                or tok.startswith("--"):
            break
        j, consumed = 1, False
        while j < len(tok):
            if tok[j] in "cCdnsOu":
                if j + 1 >= len(tok):
                    consumed = True
                break
            j += 1
        i += 2 if consumed else 1
    if i < n and not re.match(r"^\d*[<>]", rest[i]):
        return rest[i]
    return ""


def _indirect_poison(argv0, rest, drift):
    hit = False
    if argv0 == "printf":
        hit = len(rest) > 1 and rest[0] == "-v" \
            and _base(rest[1]) in ENV_POISON
    elif argv0 == "read":
        hit = any(_base(w) in ENV_POISON
                  for w in _read_names(rest))
    elif argv0 == "getopts":
        i = 0
        if rest[:1] == ["-a"]:
            i = 2
        elif rest and rest[0].startswith("-a"):
            i = 1
        hit = len(rest) > i + 1 \
            and _base(rest[i + 1]) in ENV_POISON
    elif argv0 in ("mapfile", "readarray"):
        hit = _base(_mapfile_name(rest)) in ENV_POISON
    if hit and "helper-env-poison" not in drift:
        drift.append("helper-env-poison")


def _check_poison_assign(pre, argv0, rest, drift):
    # Loader/startup rebinding in prefix assigns or declaration
    # builtins. Two safe idioms pass: IFS= scoped to read (a
    # builtin, so no resolution happens under it) and local
    # IFS (function-scoped, restored on return).
    for word in pre:
        m = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)",
                         word)
        if not m or m.group(1) not in ENV_POISON:
            continue
        if m.group(1) == "IFS" and argv0 == "read":
            continue
        if "helper-env-poison" not in drift:
            drift.append("helper-env-poison")
    if argv0 in ("export", "local", "readonly", "declare",
                "typeset"):
        i = 0
        while i < len(rest) and rest[i].startswith("-") \
                and "=" not in rest[i]:
            i += 1
        for word in rest[i:]:
            m = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)",
                             word)
            if not m:
                continue
            if m.group(1) not in ENV_POISON:
                continue
            if argv0 == "local" and m.group(1) == "IFS":
                continue
            if "helper-env-poison" not in drift:
                drift.append("helper-env-poison")
    _indirect_poison(argv0, rest, drift)


def _env_value_hit(text):
    # NAME=value for a poison NAME anywhere in the written
    # words (\b keeps MY_PATH silent).
    return any(re.search(r"\b" + v + r"\s*=", text)
               for v in ENV_POISON)


def _has_cmdsub(text):
    # Computed content (command substitution lands in the
    # file, unverifiable); $(( )) arithmetic excluded --
    # script math, and the arithmetic rule audits its own
    # expansions.
    return "`" in text.replace("\\`", "") \
        or re.search(r"\$\((?!\()", text) is not None


def _split_glued_redirect(tok):
    # (kept, is_redirect) for one raw token: split at the
    # first unquoted </> (a quoted 'a>b' is a value, not an
    # operator). Pure operators (2>err, >&2, <<EOF) keep
    # nothing; a non-fd prefix (A=1>$GITHUB_ENV) keeps the
    # printed value; <( )/>( ) expand to /dev/fd paths the
    # writer prints, so they keep whole; <<< keeps its word
    # (herestring content is written).
    quote, i = None, 0
    while i < len(tok):
        ch = tok[i]
        if quote:
            if ch == quote:
                quote = None
            i += 1
        elif ch in "\"'":
            quote, i = ch, i + 1
        elif ch == "\\" and i + 1 < len(tok):
            i += 2
        elif ch in "><":
            if tok[i:i + 2] in ("<(", ">("):
                return tok, False
            if tok[i:i + 3] == "<<<":
                return tok[i + 3:] or None, True
            if re.fullmatch(r"\d*&?", tok[:i]):
                return None, True
            return tok[:i], True
        else:
            i += 1
    return tok, False


def _strip_redir_words(words):
    # Drop redirect operators plus their targets from raw
    # tokens (glued or split); fd dups (2>&1) drop as
    # non-values too. Kept words come back unquoted; the
    # standalone class requires an operator char, so a bare
    # number word (echo 2) is a value, not an fd.
    out, skip = [], False
    for w in words:
        if skip:
            skip = False
            continue
        if re.fullmatch(r"\d*[&><][&>|><-]*", w):
            if w != "<<<":
                skip = True
            continue
        kept, is_redir = _split_glued_redirect(w)
        if not is_redir or kept:
            out.append(unquote(kept if is_redir else w))
    return [v for v in out
            if github_cmdfile_kind(v) is None]


def _heredoc_passthrough(argv0, vals, piece):
    # cat/tee with a heredoc and no other file operands write
    # the body (audited separately); anything else is an
    # unverifiable writer.
    if argv0 not in ("cat", "tee") or "<<" not in piece:
        return False
    rest = [w for w in vals
            if not re.fullmatch(r"-[a-zA-Z]+", w)]
    out, skip = [], False
    for w in rest:
        if skip:
            skip = False
            continue
        if w == "<<":
            skip = True
            continue
        if w.startswith("<<"):
            continue
        out.append(w)
    return not out


def _cmdfile_writer_books(piece):
    # (argv0, vals) with redirect words and leading VAR=
    # prefixes removed; None when the piece writes nothing
    # (bare redirect only truncates/creates).
    words = _strip_redir_words(tokenize(piece))
    i = 0
    while i < len(words) and re.fullmatch(
            r"[A-Za-z_][A-Za-z0-9_]*=\S*", words[i]):
        i += 1
    if i >= len(words):
        return None
    return words[i], words[i + 1:]


def audit_github_cmdfile_writes(cleaned, drift):
    # Values redirected to runner command files: poison
    # assigns to $GITHUB_ENV export to later steps (BASH_ENV=
    # sources attacker code under META_API_KEY); $GITHUB_PATH
    # entries prepend to PATH (workspace/relative entries let
    # staged binaries shadow system tools). $-anchored PATH
    # entries stay silent (the blessed installer appends
    # ${install_dir}; unknown env values are out of scope).
    # Unknown writers (cat file, cmd substitution output)
    # fail closed; cat/tee heredocs defer to the body audit.
    if "helper-env-poison" in drift:
        return
    for piece, _, _ in split_commands2(cleaned):
        kinds = {github_cmdfile_kind(unquote(t))
                 for t in redirect_targets(piece)}
        kinds.discard(None)
        if not kinds:
            continue
        books = _cmdfile_writer_books(piece)
        if books is None:
            continue
        argv0, vals = books
        if "env" in kinds:
            if argv0 not in ("echo", "printf") \
                    and not _heredoc_passthrough(argv0, vals,
                                                 piece):
                drift.append("helper-env-poison")
                return
            if _env_value_hit(" ".join([argv0] + vals)) \
                    or _has_cmdsub(" ".join(vals)):
                drift.append("helper-env-poison")
                return
        if "path" in kinds:
            if argv0 not in ("echo", "printf") \
                    and not _heredoc_passthrough(argv0, vals,
                                                 piece):
                drift.append("helper-env-poison")
                return
            pct_format = False
            if argv0 == "printf":
                if vals and "%" in vals[0]:
                    vals = vals[1:]
                    pct_format = True
                vals = [v for v in vals if v != ""]
            if argv0 == "echo":
                while vals and re.fullmatch(r"-[neE]+",
                                            vals[0]):
                    vals = vals[1:]
            if not vals:
                # Bare echo (or a printf format with no
                # args) writes a newline: an empty PATH
                # entry resolves to the CWD.
                if argv0 == "echo" or pct_format:
                    drift.append("helper-env-poison")
                    return
                continue
            if any(_has_cmdsub(v) for v in vals):
                drift.append("helper-env-poison")
                return
            if any(_ws_rooted(v) or not v.startswith(("/", "$"))
                   for v in vals):
                drift.append("helper-env-poison")
                return


def audit_github_cmdfile_body(kind, text, drift, quoted=False):
    # Heredoc body lines feeding a command file (literal
    # content lands verbatim, quoted or not): whole lines are
    # entries, so no argv0 skipping. Unquoted bodies expand,
    # so command substitution there is computed content.
    if "helper-env-poison" in drift:
        return
    line = text.strip()
    if not line:
        return
    if not quoted and _has_cmdsub(line):
        drift.append("helper-env-poison")
        return
    if kind == "env":
        if _env_value_hit(line):
            drift.append("helper-env-poison")
    elif _ws_rooted(line) or not line.startswith(("/", "$")):
        drift.append("helper-env-poison")


def audit_env_dump(argv0, rest, drift):
    # Environment disclosure: printenv always prints, bare
    # export/declare/typeset/readonly/local/set dump state,
    # and -p prints values. Assignments, flags (set -p is
    # privileged-mode, not a dump), and -f code listings pass.
    if "helper-env-dump" in drift:
        return
    if argv0 == "printenv" or not rest:
        drift.append("helper-env-dump")
        return
    if argv0 == "set":
        return
    for tok in rest:
        if tok in ("-p", "-P"):
            break
        if re.fullmatch(r"-[a-zA-Z]+", tok) and "p" in tok:
            break
    else:
        return
    drift.append("helper-env-dump")
