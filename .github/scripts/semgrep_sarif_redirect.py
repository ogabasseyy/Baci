"""Shell redirect-target extraction for the SARIF drift audit:
output-redirect targets outside quotes, fd-dup file targets, and
Bash socket-redirection detection (/dev/tcp, /dev/udp).
Split from semgrep_sarif_scan (300-line limit); imports the
brace skipper back from scan (no cycle: scan never imports
redirect).
"""
import re
from semgrep_sarif_scan import skip_braced
from semgrep_sarif_shell import _bare_word


def redirect_targets(text, inputs=False):
    # Output-redirect targets outside quotes: >, >>, >|, &>,
    # &>>, <>, >&file. Inputs (<) yield only with inputs=True
    # (for the socket scan -- plain inputs must not reach the
    # write-zone rules, where a trusted-script read would drift);
    # heredocs (<<), fd dups (>&2, >&-) yield nothing; >( )
    # itself yields nothing but the command inside is still
    # scanned for nested writes. Unterminated quotes read to end
    # of line; such input is a loud bash syntax error anyway.
    # ${...} expansions are skipped (a default value may hold a
    # comparison >, as in ${X:-a>b}); $(...) is still scanned
    # because redirections inside command substitution are real.
    # Residual: a redirect nested in $(...) inside a skipped
    # ${...} default is missed -- adversarial obfuscation, out of
    # the accident-scope model (fork PRs skip the audit anyway).
    targets = []
    quote, i = None, 0
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == quote:
                quote = None
            i += 1
        elif ch in ("'", '"'):
            quote, i = ch, i + 1
        elif ch == "$" and text[i:i + 2] == "${":
            i = skip_braced(text, i)
        elif ch == "&" and text[i:i + 3] == "&>>":
            i = _redirect_target(text, i + 3, targets)
        elif ch == "&" and text[i:i + 2] == "&>":
            i = _redirect_target(text, i + 2, targets)
        elif ch == "<" and text[i:i + 2] == "<>":
            i = _redirect_target(text, i + 2, targets)
        elif ch == "<" and inputs \
                and text[i + 1:i + 2] not in ("<", "&", "("):
            i = _redirect_target(text, i + 1, targets)
        elif ch == ">":
            if text[i + 1:i + 2] == "&":
                i = _dup_target(text, i + 2, targets)
            elif text[i + 1:i + 2] in (">", "|"):
                i = _redirect_target(text, i + 2, targets)
            else:
                i = _redirect_target(text, i + 1, targets)
        else:
            i += 1
    return targets

def _is_socket_target(target):
    # Bash /dev/tcp/host/port and /dev/udp/host/port open TCP
    # sockets (not files). Bare-normalized: /d\ev/tcp/... still
    # connects.
    return re.match(r"^/dev/(tcp|udp)/",
                    _bare_word(target)) is not None

def has_socket_redirect(text):
    # Any redirect operator (in or out) targeting a Bash socket.
    return any(_is_socket_target(t)
               for t in redirect_targets(text, inputs=True))

def _redirect_target(text, i, targets):
    while i < len(text) and text[i] in (" ", "\t"):
        i += 1
    if i < len(text) and text[i] in ("'", '"'):
        quote, j = text[i], i + 1
        while j < len(text) and text[j] != quote:
            j += 1
        targets.append(text[i + 1:j])
        return j + 1
    j = i
    while j < len(text) and text[j] not in (" ", "\t", ";",
                                            "|", "&", "<", ">",
                                            "(", ")"):
        j += 1
    if j > i:
        targets.append(text[i:j])
    return j

def _dup_target(text, i, targets):
    # >&word duplicates onto a file only when word is neither an
    # fd nor -; >&2/>&-/>&2- stay silent.
    j = i
    while j < len(text) and text[j] not in (" ", "\t", ";",
                                            "|", "&", "<", ">",
                                            "(", ")"):
        j += 1
    word = text[i:j]
    if word and word != "-" and not re.fullmatch(r"\d+-?", word):
        targets.append(word)
    return j

