"""Deferred-evaluator operands: trap handlers and mapfile -C
callbacks execute later with ambient authority, so the audit
extracts them for recursive command analysis.
"""


def _trap_handler(rest):
    # Handler operand of trap, or None when provably inert
    # (bare/list/print, reset, ignore).
    ops = [t for t in rest if t != "--"]
    if not ops:
        return None
    if ops[0].startswith("-") and len(ops[0]) > 1 \
            and all(c in "lp" for c in ops[0][1:]):
        return None
    if ops[0] in ("-", ""):
        return None
    return ops[0]


def _mapfile_callback(rest):
    # -C callback word, or None when absent. Other value
    # flags advance past their values so a value is never
    # mistaken for the callback.
    i, n = 0, len(rest)
    while i < n:
        tok = rest[i]
        if tok == "--" or not tok.startswith("-") \
                or len(tok) == 1 or tok.startswith("--"):
            return None
        j, consumed = 1, False
        while j < len(tok):
            if tok[j] == "C":
                if j + 1 < len(tok):
                    return tok[j + 1:]
                if i + 1 < n:
                    return rest[i + 1]
                return None
            if tok[j] in "cCdnsOu":
                if j + 1 >= len(tok):
                    consumed = True
                break
            j += 1
        i += 2 if consumed else 1
    return None
