"""Top-level variable resolution for helper audits: last
literal assignment per name (bash last-wins) with fail-closed
pops on every unmodellable rebinding (compound, conditional,
piped, arithmetic, indirect, unset). Tracks declare/local/
typeset -n nameref edges (transitively) so $ref resolves to
its target; plain assigns to a ref-name write through (the
edge stands, the target pops). Returns map, stale set, and
edges. Carry vars never follow edges (they stay literal
anchors). Residual: non-name targets (arr[0], $dyn) pop.
"""
import re
from semgrep_sarif_nameref import (_split_top, follow_nameref,
                                   nameref_decl)
from semgrep_sarif_poison import _mapfile_name, _read_names
from semgrep_sarif_scan import arith_regions, _paren_end
from semgrep_sarif_shell import (strip_comments, tokenize)

CARRY_VARS = ("HOME", "GITHUB_WORKSPACE", "RUNNER_TEMP",
              "SCRIPT_DIR", "TMPDIR", "TEMP", "TMP")
_DECL = r"(?:export|declare|local|readonly|typeset)\s+"


def _single_pipe(seg):
    code = re.sub(r"\"(?:[^\"\\]|\\.)*\"", "\"\"", seg)
    code = re.sub(r"'[^']*'", "''", code)
    return re.search(r"(?<!\|)\|(?!\|)", code) is not None


def _pop_later_assigns(piece, varmap, stale):
    # Multi-assign remainder (export A=x B=y): values cannot be
    # attributed past the first, so every later name pops.
    rest = re.sub(r"^\s*(?:" + _DECL + r")?[A-Za-z_]\w*\s*"
                  r"\+?=(?![=~])", "", piece, count=1)
    for name in re.findall(r"(?:^|[\s;&])([A-Za-z_]\w*)"
                           r"\s*\+?=(?![=~])", rest):
        varmap.pop(name, None)
        stale.add(name)


def _pop_indirect(piece, varmap, stale):
    toks = tokenize(piece)
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
        elif tok == "-v" and i + 1 < len(toks):
            name = toks[i + 1].strip("\"'")
            if re.fullmatch(r"[A-Za-z_]\w*", name):
                varmap.pop(name, None)
                stale.add(name)
        elif tok.startswith("-v") and len(tok) > 2 \
                and not tok.startswith("--"):
            name = tok[2:].strip("\"'")
            if re.fullmatch(r"[A-Za-z_]\w*", name):
                varmap.pop(name, None)
                stale.add(name)
        elif tok == "getopts" and i + 2 < len(toks):
            for name in (toks[i + 2], "OPTARG"):
                name = name.strip("\"'")
                if re.fullmatch(r"[A-Za-z_]\w*", name):
                    varmap.pop(name, None)
                    stale.add(name)


def _collect_piece(piece, volatile, indented, carry, varmap,
                   stale, namerefs):
    if not piece:
        return
    if nameref_decl(piece, not volatile and not indented,
                    varmap, stale, namerefs):
        _pop_indirect(piece, varmap, stale)
        return
    m = re.match(r"\s*(?:" + _DECL + r")?([A-Za-z_]\w*)"
                 r"\s*(\+)?=(?![=~])(.*)$", piece)
    if m and m.group(1) in namerefs:
        # Write-through: the edge stands, the target's
        # cached value is now wrong. Null the match so the
        # name itself is never varmap-set below.
        tgt = follow_nameref(namerefs[m.group(1)], namerefs,
                             CARRY_VARS)
        varmap.pop(tgt, None)
        stale.add(tgt)
        m = None
    if m and not volatile and not indented and not m.group(2):
        name, val = m.group(1), m.group(3).strip()
        if len(val) >= 2 and val[0] == val[-1] \
                and val[0] in ("'", '"'):
            inner = val[1:-1]
        elif re.fullmatch(r"\S+", val or " "):
            inner = val
        else:
            varmap.pop(name, None)
            stale.add(name)
            inner = None
        if inner is not None:
            if "`" in inner or "$(" in inner:
                varmap.pop(name, None)
                stale.add(name)
            else:
                scrubbed = re.sub(r"\$(?:\{" + carry + r"\}|"
                                  + carry + r")", "", inner)
                if "$" in scrubbed:
                    varmap.pop(name, None)
                    stale.add(name)
                else:
                    varmap[name] = inner
                    stale.discard(name)
    elif m:
        varmap.pop(m.group(1), None)
        stale.add(m.group(1))
    _pop_later_assigns(piece, varmap, stale)
    _pop_indirect(piece, varmap, stale)
    m = re.match(r"\s*(?:" + _DECL + r")?(?:for|select)\s+"
                 r"([A-Za-z_]\w*)", piece)
    if m:
        varmap.pop(m.group(1), None)
        stale.add(m.group(1))
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
        stale.discard(name)


def _collect_vars(raw_lines):
    # Last top-level literal per name (bash last-wins, ;-chains
    # in order), so ${install_dir}/... resolves before path
    # checks. Every unmodellable rebinding pops: +=, declare
    # forms, unset, arithmetic, read/printf -v/mapfile/getopts,
    # loop vars, indented (conditional-scope) and &&/||-guarded
    # or piped (subshell-lost) assigns. Stale names are
    # returned alongside for the unresolved-command rule.
    carry = "(?:" + "|".join(CARRY_VARS) + ")"
    varmap, stale, namerefs = {}, set(), {}
    for raw in raw_lines:
        line = strip_comments(raw)
        indented = line[:1] in (" ", "\t")
        for seg in _split_top(line, (";",)):
            piped = _single_pipe(seg)
            chains = _split_top(seg, ("&&", "||"))
            for ci, piece in enumerate(chains):
                _collect_piece(piece.strip(), ci > 0 or piped,
                               indented, carry, varmap, stale,
                               namerefs)
    for _ in range(3):
        for key in varmap:
            varmap[key] = _resolve(varmap[key], varmap,
                                   namerefs)
    return varmap, stale, namerefs


def _resolve(text, varmap, namerefs=None):
    # Plain $V and ${V} only; ${V-op...} expansions keep their
    # literal text (fail closed). Nameref names follow their
    # edges first, so $ref surfaces the target's text.
    # Single-quote imprecision is fail-closed: resolving a
    # literal can only add markers.
    refs = namerefs or {}

    def sub(m):
        name = follow_nameref(m.group(2), refs, CARRY_VARS)
        if name not in varmap:
            if name != m.group(2):
                return "$" + name
            return m.group(0)
        if m.group(1):
            if not m.group(3):
                return m.group(0)
            return varmap[name]
        if m.group(3):
            return varmap[name] + "}"
        return varmap[name]
    return re.sub(r"\$(\{)?([A-Za-z_][A-Za-z0-9_]*)(\})?",
                  sub, text)


def audit_unresolved_argv(argv0, stale, drift):
    # A stale (assigned-but-unresolvable) name in command
    # position: bash executes the dynamic value while the
    # auditor sees only the literal. Never-assigned artifact
    # ${vars} are not stale, so no FPs. $() (command
    # substitution) and caller-controlled positionals are
    # dynamic by construction.
    if "helper-unresolved-command" in drift:
        return
    if argv0 == "$()" or argv0 in ("$@", "$*", "$_") \
            or re.match(r"\$[0-9]", argv0):
        drift.append("helper-unresolved-command")
        return
    m = re.match(r"\$(?:\{([A-Za-z_]\w*)[^}]*\}"
                 r"|([A-Za-z_]\w*))", argv0)
    if m and (m.group(1) or m.group(2)) in stale:
        drift.append("helper-unresolved-command")
