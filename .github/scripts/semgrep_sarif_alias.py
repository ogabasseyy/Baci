"""Installer alias closure: names deriving from $tmp_bin (direct
assigns, read/printf -v/for rebinds, declare -n edges), closed
transitively for the post-verify freeze.
"""
import re
from semgrep_sarif_nameref import _split_top
from semgrep_sarif_poison import _read_names
from semgrep_sarif_shell import _bare_word, tokenize


def _refs_frozen(text, frozen):
    return any(re.search(r"\$\{?" + n + r"\b", text)
               for n in frozen)


def _rebind_names(piece):
    # read/printf -v/for/select targets on one piece. mapfile
    # yields content and getopts single chars, never paths.
    names = []
    toks = [_bare_word(t) for t in tokenize(piece)]
    for i, tok in enumerate(toks):
        if tok == "read":
            names.extend(_read_names(toks[i + 1:])
                         or ["REPLY"])
        elif tok == "-v" and i + 1 < len(toks):
            names.append(toks[i + 1])
        elif tok.startswith("-v") and len(tok) > 2 \
                and not tok.startswith("--"):
            names.append(tok[2:])
    m = re.match(r"\s*(?:for|select)\s+([A-Za-z_]\w*)",
                 piece)
    if m:
        names.append(m.group(1))
    return [n.strip("\"'") for n in names
            if re.fullmatch(r"[A-Za-z_]\w*",
                            n.strip("\"'"))]


def _nameref_edges(text):
    # declare/local/typeset -n name=target pairs on one
    # piece (quote-aware values; +n drops). Writes through
    # the ref hit the target, so a ref to a frozen name is
    # itself frozen.
    dm = re.match(r"\s*(declare|local|typeset)\s+(.*)$",
                  text)
    if not dm:
        return []
    words = [_bare_word(w)
             for w in _split_top(dm.group(2), (" ", "\t"))
             if w.strip()]
    flags = [w for w in words
             if re.fullmatch(r"[+-][A-Za-z]+", w)]
    if not any("n" in w[1:] for w in flags):
        return []
    if any(w.startswith("+") and "n" in w[1:]
           for w in flags):
        return []
    edges = []
    for word in words:
        if word in flags or "=" not in word:
            continue
        name, tgt = word.split("=", 1)
        name = name.strip("\"'")
        tgt = tgt.strip("\"'")
        if re.fullmatch(r"[A-Za-z_]\w*", name or "") \
                and re.fullmatch(r"[A-Za-z_]\w*", tgt or ""):
            edges.append((name, tgt))
    return edges


def audit_tmp_aliases(installer):
    # Names whose value derives from $tmp_bin (the frozen
    # artifact path): direct assigns anywhere in the file plus
    # read/printf -v/for rebinds and -n nameref edges, closed
    # transitively. Only $-references count (a bare
    # `replacement` is a literal filename). got_sha joins
    # textually but is never written post-verify: harmless.
    frozen = {"tmp_bin"}
    changed = True
    while changed:
        changed = False
        for line in installer:
            for seg in _split_top(line, (";",)):
                for piece in _split_top(seg, ("&&", "||")):
                    text = piece.strip()
                    m = re.match(
                        r"(?:export|declare|local|readonly|"
                        r"typeset)?\s*([A-Za-z_]\w*)=(.*)$",
                        text)
                    if m and _refs_frozen(m.group(2), frozen) \
                            and m.group(1) not in frozen:
                        frozen.add(m.group(1))
                        changed = True
                    for name, tgt in _nameref_edges(text):
                        if tgt in frozen \
                                and name not in frozen:
                            frozen.add(name)
                            changed = True
                    if _refs_frozen(text, frozen):
                        for name in _rebind_names(text):
                            if name not in frozen:
                                frozen.add(name)
                                changed = True
    return frozen


