"""Heredoc splitting for the helper audit: quoted bodies drop
(expansion suppressed), unquoted bodies return separately for
expansion-only audit. Bodies feeding $GITHUB_ENV/$GITHUB_PATH
additionally return tagged (even quoted: literal content still
lands in the file) for command-file value audit.
"""
import re
from semgrep_sarif_scan import (github_cmdfile_kind,
                                skip_braced)


def _cmdfile_kind(line):
    # "env"/"path" when the opener line redirects (unquoted
    # >>, >, >|, &>, fd-prefixed) to a runner command file.
    # Quote-aware: a quoted >> mention is data, and quoted
    # targets read to their matching quote.
    i, n = 0, len(line)
    while i < n:
        ch = line[i]
        if ch in ("'", '"'):
            q = ch
            i += 1
            while i < n and line[i] != q:
                i += 2 if line[i] == "\\" and i + 1 < n \
                    else 1
            i += 1
        elif ch == "\\":
            i += 2
        elif ch == "#":
            return None
        else:
            m = re.match(r"&?\d?>>?\|?", line[i:])
            if not m or not m.group(0):
                i += 1
                continue
            j = i + len(m.group(0))
            while j < n and line[j] in (" ", "\t"):
                j += 1
            if j < n and line[j] in ("'", '"'):
                q, k = line[j], j + 1
                while k < n and line[k] != q:
                    k += 1
                word, j = line[j + 1:k], k + 1
            else:
                k = j
                while k < n and line[k] not in (" ", "\t",
                                                ";", "|", "&",
                                                "<", ">", "(",
                                                ")"):
                    k += 1
                word, j = line[j:k], k
            kind = github_cmdfile_kind(word)
            if kind is not None:
                return kind
            i = j if j > i else i + 1
    return None


def _strip_heredocs(raw_lines):
    # Split off heredoc bodies, returning (code, bodies,
    # env_bodies). Quoted delimiters (<<'EOF', <<"EOF",
    # <<\EOF) suppress expansion: those bodies drop from the
    # expansion audit -- but a body feeding a runner command
    # file is still audited for values (literal content lands
    # verbatim). Tracks quoted and ${} regions so a << inside
    # them cannot start a fake body that would hide real code;
    # <<< is a herestring, never a heredoc. Empty delimiters
    # never push.
    out, bodies, env_bodies, pending = [], [], [], []
    for line in raw_lines:
        if pending:
            delim, tabs, quoted, kind = pending[0]
            text = line.lstrip("\t") if tabs else line
            if text == delim:
                pending.pop(0)
            else:
                if not quoted:
                    bodies.append(line)
                if kind is not None:
                    env_bodies.append((kind, quoted, line))
            out.append("")
            continue
        out.append(line)
        i, quote = 0, None
        while i < len(line):
            ch = line[i]
            if quote:
                if ch == quote:
                    quote = None
                i += 1
            elif ch in ("'", '"'):
                quote, i = ch, i + 1
            elif ch == "\\":
                i += 2
            elif ch == "#":
                break
            elif ch == "$" and line[i:i + 2] == "${":
                i = skip_braced(line, i)
            elif ch == "<" and line[i:i + 2] == "<<" \
                    and line[i:i + 3] != "<<<":
                j = i + 2
                tabs = False
                if j < len(line) and line[j] == "-":
                    tabs, j = True, j + 1
                while j < len(line) \
                        and line[j] in (" ", "\t"):
                    j += 1
                if j < len(line) and line[j] in ("'", '"'):
                    q, k = line[j], j + 1
                    while k < len(line) and line[k] != q:
                        k += 1
                    delim, j = line[j + 1:k], k + 1
                    quoted = True
                else:
                    k = j
                    while k < len(line) \
                            and line[k] not in (" ", "\t", ";",
                                                "|", "&", "(",
                                                ")", "<", ">"):
                        k += 1
                    word, j = line[j:k], k
                    # Any backslash quotes the delimiter
                    # (<<\EOF expands nothing); unescape it so
                    # the terminator still matches.
                    quoted = "\\" in word
                    delim = re.sub(r"\\(.)", r"\1", word)
                if delim:
                    pending.append((delim, tabs, quoted,
                                    _cmdfile_kind(line)))
                i = j
            else:
                i += 1
    return out, bodies, env_bodies
