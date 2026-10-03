"""Binutils output destinations: objcopy/ld/as/strip/ar/ranlib
write outputs the copy dispatch must zone (last-operand, -o,
dump-section, and archive conventions).
"""
import re
from semgrep_sarif_words import _flag_value, _operands


def _dash_o_output(rest):
    # -o/--output value (separate, =-glued, or short-glued):
    # the linked/assembled/stripped output file.
    out = _flag_value(rest, ("-o", "--output"))
    if out is not None:
        return out
    for tok in rest:
        if re.fullmatch(r"-o\S+", tok):
            return tok[2:]
    return None


def _objcopy_dumps(rest):
    # --dump-section NAME=FILE outputs (every occurrence: a
    # second flag would otherwise smuggle its destination).
    dumps = []
    i = 0
    while i < len(rest):
        tok = rest[i]
        if tok == "--dump-section" and i + 1 < len(rest):
            dumps.append(rest[i + 1].split("=", 1)[-1])
            i += 2
        elif tok.startswith("--dump-section="):
            dumps.append(tok.split("=", 1)[1].split("=", 1)[-1])
            i += 1
        else:
            i += 1
    return dumps


def _ar_archive(rest):
    # Archive operand of ar: the operand past the operation
    # letters (undashed) or the first operand (dashed-op
    # form), for modifying ops only (r/q/d/m; t/p/x read or
    # restore without planting bytes, like tar -x without
    # -C). None when absent or read-only. Pure-letter
    # archive names in dashed form misread as the op, but
    # those are relative paths: unzoned either way.
    ops = _operands(rest)
    letters = ""
    for tok in rest:
        if re.fullmatch(r"[dmpqrtx][A-Za-z]*", tok):
            letters += tok
        elif re.fullmatch(r"-[A-Za-z]+", tok):
            letters += tok[1:]
    if not set(letters) & set("rqdm") or not ops:
        return None
    for i, op in enumerate(ops):
        if re.fullmatch(r"[dmpqrtx][A-Za-z]*", op):
            return ops[i + 1] if i + 1 < len(ops) else None
    return ops[0]



def audit_binutils_targets(base, rest):
    # (targets, implicit-zone) for a binutils invocation.
    if base == "objcopy":
        # in-file [out-file]: the last operand, or the lone
        # operand (in-place), plus every --dump-section dest.
        ops = _operands(rest)
        return ([ops[-1]] if ops else []) + _objcopy_dumps(rest), None
    if base in ("ld", "as"):
        # -o output, else the default a.out in the CWD
        # (the workspace at helper runtime); no operands
        # (--help/--version) stays silent.
        out = _dash_o_output(rest)
        if out is not None:
            return [out], None
        if _operands(rest):
            return [], "workspace"
        return [], None
    if base == "strip":
        # -o output, else every file operand (in place).
        out = _dash_o_output(rest)
        return ([out] if out is not None else _operands(rest)), None
    if base == "ar":
        arch = _ar_archive(rest)
        return ([arch] if arch is not None else []), None
    if base == "ranlib":
        return _operands(rest), None
    return [], None
