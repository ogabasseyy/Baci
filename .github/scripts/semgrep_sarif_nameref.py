"""Bash nameref tracking for the variable audit: declare/
local/typeset -n edges resolve transitively at use, so
$ref surfaces its target's text (a ref to GH_TOKEN trips
the secret rule). Plain assigns to a ref-name write through
(the edge stands, the target pops). export -n un-exports: a
different flag, excluded. Carry vars never follow edges.
Residual: non-name targets (arr[0], $dyn) pop.
"""
import re


def _split_top(text, delims):
    # Quote-aware split on delimiter strings (backslash-aware).
    # No paren tracking: ;-fragments inside $(...) always pop
    # (dynamic) or skip (no assign), so outcomes stay correct.
    parts, buf, quote = [], "", None
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if quote:
            buf += ch
            if ch == "\\" and i + 1 < n:
                buf += text[i + 1]
                i += 1
            elif ch == quote:
                quote = None
            i += 1
        elif ch in ("'", '"'):
            quote, buf = ch, buf + ch
            i += 1
        elif ch == "\\" and i + 1 < n:
            buf += text[i:i + 2]
            i += 2
        else:
            hit = next((d for d in delims
                        if text.startswith(d, i)), None)
            if hit is None:
                buf += ch
                i += 1
            else:
                parts.append(buf)
                buf = ""
                i += len(hit)
    parts.append(buf)
    return parts


def nameref_decl(piece, record, varmap, stale, namerefs):
    # record is False for volatile/indented pieces: the edge
    # is uncertain, so edges clear and names stale. Returns
    # True when the piece is a nameref declaration (every
    # pair handled explicitly, so the later-assign popper
    # stands down for it). Pair splitting is quote-aware: a
    # spaced value ('a b') is one invalid target, never two
    # phantom words.
    dm = re.match(r"\s*(declare|local|typeset)\s+(.*)$",
                  piece)
    if not dm:
        return False
    words = [w for w in _split_top(dm.group(2), (" ", "\t"))
             if w.strip()]
    flags = [w for w in words
             if re.fullmatch(r"[+-][A-Za-z]+", w)]
    if not any("n" in w[1:] for w in flags):
        return False
    rest = [w for w in words if w not in flags]
    if any(w.startswith("+") and "n" in w[1:]
           for w in flags) or not record:
        for word in rest:
            name = word.split("=", 1)[0].strip("\"'")
            if re.fullmatch(r"[A-Za-z_]\w*", name):
                namerefs.pop(name, None)
                varmap.pop(name, None)
                stale.add(name)
        return True
    for word in rest:
        if "=" not in word:
            name = word.strip("\"'")
            if re.fullmatch(r"[A-Za-z_]\w*", name):
                namerefs.pop(name, None)
                varmap.pop(name, None)
                stale.add(name)
            continue
        name, tgt = word.split("=", 1)
        name = name.strip("\"'")
        tgt = tgt.strip("\"'")
        if not re.fullmatch(r"[A-Za-z_]\w*", name):
            continue
        varmap.pop(name, None)
        if re.fullmatch(r"[A-Za-z_]\w*", tgt):
            namerefs[name] = tgt
            stale.discard(name)
        else:
            namerefs.pop(name, None)
            stale.add(name)
    return True


def follow_nameref(name, namerefs, carry_vars):
    # Transitive target (cycle-guarded); carry vars never
    # follow (they stay literal anchors).
    seen = {name}
    for _ in range(8):
        if name in carry_vars or name not in namerefs:
            return name
        name = namerefs[name]
        if name in seen:
            return name
        seen.add(name)
    return name
