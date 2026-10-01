"""Heredoc splitting for the helper audit: quoted bodies drop
(expansion suppressed), unquoted bodies return separately for
expansion-only audit.
"""
import re
from semgrep_sarif_scan import skip_braced

def _strip_heredocs(raw_lines):
    # Split off heredoc bodies, returning (code, bodies).
    # Quoted delimiters (<<'EOF', <<"EOF", <<\EOF) suppress
    # expansion: those bodies drop. Unquoted bodies expand
    # ($(), $var, $(()) -- verified: executed), so they return
    # separately for expansion-only audit (body words are stdin
    # data, never commands). Tracks quoted and ${} regions so a
    # << inside them cannot start a fake body that would hide
    # real code; <<< is a herestring, never a heredoc. Empty
    # delimiters never push.
    out, bodies, pending = [], [], []
    for line in raw_lines:
        if pending:
            delim, tabs, quoted = pending[0]
            text = line.lstrip("\t") if tabs else line
            if text == delim:
                pending.pop(0)
            elif not quoted:
                bodies.append(line)
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
                    pending.append((delim, tabs, quoted))
                i = j
            else:
                i += 1
    return out, bodies
