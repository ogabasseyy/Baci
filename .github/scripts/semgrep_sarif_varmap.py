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
from semgrep_sarif_nameref import _split_top, follow_nameref
from semgrep_sarif_shell import strip_comments
from semgrep_sarif_varcollect import CARRY_VARS, _collect_piece
from semgrep_sarif_words import _single_pipe

def _collect_vars(raw_lines):
    # Last top-level literal per name (bash last-wins, ;-chains
    # in order), so ${install_dir}/... resolves before path
    # checks. Every unmodellable rebinding pops: +=, declare
    # forms, unset, arithmetic, read/printf -v/mapfile/getopts,
    # loop vars, indented (conditional-scope) and &&/||-guarded
    # or piped (subshell-lost) assigns. Stale names are
    # returned alongside for the unresolved-command rule; the
    # opaque set (may-analysis: indirect/loop/$-shaped binds
    # add, clean and numeric-safe binds discard, conditional
    # numeric-safe binds no-op) feeds the arithmetic-recursion
    # rule: opaque values can hide crafted subscripts.
    carry = "(?:" + "|".join(CARRY_VARS) + ")"
    varmap, stale, namerefs, opaque = {}, set(), {}, set()
    for raw in raw_lines:
        line = strip_comments(raw)
        indented = line[:1] in (" ", "\t")
        for seg in _split_top(line, (";",)):
            piped = _single_pipe(seg)
            chains = _split_top(seg, ("&&", "||"))
            for ci, piece in enumerate(chains):
                _collect_piece(piece.strip(), ci > 0 or piped,
                               indented, carry, varmap, stale,
                               namerefs, opaque)
    for _ in range(3):
        for key in varmap:
            varmap[key] = _resolve(varmap[key], varmap,
                                   namerefs)
    return varmap, stale, namerefs, opaque


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
    if re.match(r"\"?\$\{[^A-Za-z_]", argv0) \
            or re.match(r"\"?\$\{[A-Za-z_]\w*"
                       r"[:#%/@^,+?=[\]-]", argv0):
        # Parameter operators in command position (${v:0},
        # ${v:-d}, ${v[0]}): _resolve keeps the literal text
        # while bash computes the value, so the auditor would
        # bless a different command than the one executed --
        # stale or not. Start-anchored (mid-word expansions
        # and assignments audit through their own rules); a
        # bare ${V} has its closing brace right after the
        # name, so no operator fires. A non-name char right
        # after ${ (${@}, ${#}, ${!ref}) is a special
        # parameter or operator by construction.
        drift.append("helper-unresolved-command")
        return
    if argv0 == "$()" or argv0 in ("$@", "$*", "$_") \
            or re.match(r"\$[0-9]", argv0):
        drift.append("helper-unresolved-command")
        return
    m = re.match(r"\$(?:\{([A-Za-z_]\w*)[^}]*\}"
                 r"|([A-Za-z_]\w*))", argv0)
    if m and (m.group(1) or m.group(2)) in stale:
        drift.append("helper-unresolved-command")
