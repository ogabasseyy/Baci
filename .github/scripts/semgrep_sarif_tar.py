"""Tar program-execution flags: --to-command pipes every
member through a command, --checkpoint-action=exec= runs on
each checkpoint, -F runs an info script, and -I runs a
compress program. Bundle-aware with value-taker consumption,
so -cfIx (archive named Ix) never misreads as -I. Stops at
--. Residual: old-form (dashless) tar is unsupported, like
the existing extract detection.
"""

# tar -I programs that only (de)compress fixed formats; any
# other -I value executes an attacker-chosen program.
_SAFE_COMPRESS = {"bzip2", "bunzip2", "bzip3", "compress",
                  "gunzip", "gzip", "lbzip2", "lrzip", "lz4",
                  "lzip", "lzma", "lzop", "pigz", "uncompress",
                  "unlzma", "unxz", "unzstd", "xz", "zstd"}
# tar short flags taking a value (rest of token or next).
_TAR_VALUE = {"f", "C", "T", "X", "N", "g", "K", "L", "V",
              "b", "H"}


def _compress_danger(prog):
    first = prog.split()[0] if prog.split() else ""
    return first.rsplit("/", 1)[-1] not in _SAFE_COMPRESS


def _bundle_exec(tok, nxt):
    # (exec, ate_next) for a short-flag bundle: F always
    # executes, I checks the program, value-takers consume
    # the rest (an -I inside their value is data).
    j = 1
    while j < len(tok):
        if tok[j] == "F":
            return True, False
        if tok[j] == "I":
            if tok[j + 1:]:
                return _compress_danger(tok[j + 1:]), False
            return _compress_danger(nxt), True
        if tok[j] in _TAR_VALUE:
            return False, j + 1 >= len(tok)
        j += 1
    return False, False


def audit_tar_exec(rest, drift):
    i, n = 0, len(rest)
    hit = False
    while i < n and not hit:
        tok = rest[i]
        if tok == "--":
            return
        if tok == "--to-command" \
                or tok.startswith("--to-command="):
            hit = True
        elif tok == "--checkpoint-action" and i + 1 < n:
            val = rest[i + 1]
            hit = val == "exec" or val.startswith("exec=")
            i += 1
        elif tok.startswith("--checkpoint-action="):
            val = tok.split("=", 1)[1]
            hit = val == "exec" or val.startswith("exec=")
        elif tok in ("-F", "--info-script") \
                or tok.startswith("--info-script="):
            hit = True
        elif tok in ("-I", "--use-compress-program") \
                and i + 1 < n:
            hit = _compress_danger(rest[i + 1])
            i += 1
        elif tok.startswith("--use-compress-program="):
            hit = _compress_danger(tok.split("=", 1)[1])
        elif tok.startswith("-") and not tok.startswith("--") \
                and len(tok) > 1 and "=" not in tok:
            nxt = rest[i + 1] if i + 1 < n else ""
            hit, ate = _bundle_exec(tok, nxt)
            if ate:
                i += 1
        i += 1
    if hit and "helper-untrusted-exec" not in drift:
        drift.append("helper-untrusted-exec")
