"""Runner command-file guards: values redirected to $GITHUB_ENV
(export to later steps) and $GITHUB_PATH (PATH prepend) --
poison NAME=value detection, writer confinement (echo/printf,
heredoc passthrough), and quoted-ness-aware heredoc body
audit. Copy-class whole-file replacement lives with the copy
rules (see semgrep_sarif_copy).
Split from semgrep_sarif_poison (300-line limit).
"""
import re
from semgrep_sarif_pins import _ws_rooted
from semgrep_sarif_redirect import redirect_targets
from semgrep_sarif_scan import github_cmdfile_kind
from semgrep_sarif_shell import (ENV_POISON, _bare_word,
                                 split_commands2, tokenize, unquote)


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
            out.append(_bare_word(kept if is_redir else w))
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


