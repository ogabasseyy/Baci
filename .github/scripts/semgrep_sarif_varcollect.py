"""Per-piece variable collection for helper audits: literal
assignment capture with fail-closed pops on unmodellable
rebindings, indirect/loop tracking, and nameref edges.
"""
import re
from semgrep_sarif_nameref import follow_nameref, nameref_decl
from semgrep_sarif_poison import _mapfile_name, _read_names
from semgrep_sarif_scan import _paren_end, arith_regions
from semgrep_sarif_shell import _bare_word, tokenize
from semgrep_sarif_words import (_DECL, _arith_safe_value,
                                 _assign_inner, _later_value,
                                 _pop_later_assigns)


CARRY_VARS = ("HOME", "GITHUB_WORKSPACE", "RUNNER_TEMP",
              "SCRIPT_DIR", "TMPDIR", "TEMP", "TMP")

def _pop_indirect(piece, varmap, stale, opaque):
    toks = [_bare_word(t) for t in tokenize(piece)]
    for i, tok in enumerate(toks):
        if tok in ("read", "mapfile", "readarray"):
            after = toks[i + 1:]
            if tok == "read":
                names = _read_names(after) or ["REPLY"]
            else:
                name = _mapfile_name(after)
                names = [name] if name else ["MAPFILE"]
            for name in names:
                name = re.sub(r"\[.*\]$", "", name)
                if re.fullmatch(r"[A-Za-z_]\w*", name):
                    varmap.pop(name, None)
                    stale.add(name)
                    opaque.add(name)
        elif tok == "-v" and i + 1 < len(toks):
            name = toks[i + 1].strip("\"'")
            if re.fullmatch(r"[A-Za-z_]\w*", name):
                varmap.pop(name, None)
                stale.add(name)
                opaque.add(name)
        elif tok.startswith("-v") and len(tok) > 2 \
                and not tok.startswith("--"):
            name = tok[2:].strip("\"'")
            if re.fullmatch(r"[A-Za-z_]\w*", name):
                varmap.pop(name, None)
                stale.add(name)
                opaque.add(name)
        elif tok == "getopts" and i + 2 < len(toks):
            for name in (toks[i + 2], "OPTARG"):
                name = name.strip("\"'")
                if re.fullmatch(r"[A-Za-z_]\w*", name):
                    varmap.pop(name, None)
                    stale.add(name)
                    opaque.add(name)


def _collect_piece(piece, volatile, indented, carry, varmap,
                   stale, namerefs, opaque):
    if not piece:
        return
    if nameref_decl(piece, not volatile and not indented,
                    varmap, stale, namerefs, opaque):
        _pop_indirect(piece, varmap, stale, opaque)
        return
    m = re.match(r"\s*(?:" + _DECL + r")?([A-Za-z_]\w*)"
                 r"\s*(\+)?=(?![=~])(.*)$", piece)
    if not m:
        # Builtins unescape their operands (declare \u=x assigns
        # u -- verified), while a bare \u=x is dead (verified):
        # retry letter-unescape only with a declaration prefix.
        soft = re.sub(r"\\([A-Za-z_])", r"\1", piece)
        if soft != piece:
            m = re.match(r"\s*(?:" + _DECL + r")([A-Za-z_]\w*)"
                         r"\s*(\+)?=(?![=~])(.*)$", soft)
    if m and m.group(1) in namerefs:
        # Write-through: the edge stands, the target's
        # cached value is now wrong. Null the match so the
        # name itself is never varmap-set below.
        tgt = follow_nameref(namerefs[m.group(1)], namerefs,
                             CARRY_VARS)
        varmap.pop(tgt, None)
        stale.add(tgt)
        opaque.add(tgt)
        m = None
    if m and not volatile and not indented and not m.group(2):
        name = m.group(1)
        inner = _assign_inner(m.group(3))
        if inner is None:
            varmap.pop(name, None)
            stale.add(name)
            opaque.add(name)
        if inner is not None:
            if "`" in inner or "$(" in inner:
                varmap.pop(name, None)
                stale.add(name)
                if _arith_safe_value(inner, varmap):
                    opaque.discard(name)
                else:
                    opaque.add(name)
            else:
                scrubbed = re.sub(r"\$(?:\{" + carry + r"\}|"
                                  + carry + r")", "", inner)
                if "$" in scrubbed:
                    varmap.pop(name, None)
                    stale.add(name)
                    if _arith_safe_value(inner, varmap):
                        opaque.discard(name)
                    else:
                        opaque.add(name)
                else:
                    varmap[name] = inner
                    stale.discard(name)
                    opaque.discard(name)
    elif m:
        varmap.pop(m.group(1), None)
        stale.add(m.group(1))
        # May-analysis: a conditional numeric-safe bind is a
        # no-op (value could still be a prior opaque bind);
        # anything else, and always +=, adds.
        if m.group(2):
            opaque.add(m.group(1))
        else:
            inner = _assign_inner(m.group(3))
            if inner is None \
                    or not _arith_safe_value(inner, varmap):
                opaque.add(m.group(1))
    _pop_later_assigns(piece, varmap, stale, opaque)
    _pop_indirect(piece, varmap, stale, opaque)
    m = re.match(r"\s*(?:" + _DECL + r")?(?:for|select)\s+"
                 r"([A-Za-z_]\w*)", piece)
    if m:
        varmap.pop(m.group(1), None)
        stale.add(m.group(1))
        opaque.add(m.group(1))
    m = re.match(r"\s*(?:command\s+|builtin\s+)?unset\s+(.*)$",
                 piece)
    if m:
        words = m.group(1).split()
        unref = any(re.fullmatch(r"-[A-Za-z]*n[A-Za-z]*", w)
                    for w in words)
        for word in words:
            if word == "--":
                continue
            if word.startswith("-"):
                continue
            name = re.sub(r"\[.*\]$", "",
                          word.strip("\"'"))
            if re.fullmatch(r"[A-Za-z_]\w*", name):
                if unref:
                    namerefs.pop(name, None)
                varmap.pop(name, None)
                stale.add(name)
                # Unbound reads crash-or-zero under set -u,
                # never attacker-shaped: not opaque.
                opaque.discard(name)
    regions = list(arith_regions(piece))
    for m in re.finditer(r"(?<!\$)\(\(", piece):
        j = _paren_end(piece, m.start() + 1)
        regions.append(piece[m.start() + 2:j - 1]
                       if j < len(piece)
                       else piece[m.start() + 2:])
    for region in regions:
        for name in re.findall(r"([A-Za-z_]\w*)\s*(?:\+|-|\*|"
                               r"/|%|<<|>>|&|\^|\|)?="
                               r"(?!=)", region):
            varmap.pop(name, None)
            stale.add(name)
            # Arithmetic assignment takes the RHS value: only
            # opaque when the region mentions opaque names.
            # ++/-- self-mutation preserves shape: no-op.
            if any(w in opaque for w in re.findall(
                    r"[A-Za-z_]\w*", region)):
                opaque.add(name)
        for a, b in re.findall(r"(?:\+\+|--)\s*([A-Za-z_]\w*)"
                               r"|([A-Za-z_]\w*)\s*(?:\+\+|--)",
                               region):
            varmap.pop(a or b, None)
            stale.add(a or b)
    # Write-through redirect: indirect pops (read/printf -v/
    # for/unset/arith) landing on a ref-name actually clobber
    # the target; the edge itself still resolves.
    for name in [n for n in stale if n in namerefs]:
        tgt = follow_nameref(namerefs[name], namerefs,
                             CARRY_VARS)
        varmap.pop(tgt, None)
        stale.add(tgt)
        opaque.add(tgt)
        stale.discard(name)
