"""jq invocation audit: -f program-file pinning, --run-tests
rejection, -L module-dir rejection, and inline-program env
scans. Split from semgrep_sarif_interp (300-line limit).
"""
import re

from semgrep_sarif_pins import SCRIPT_PIN
from semgrep_sarif_programs import jq_program_has_env


def _jq_program(rest):
    # Inline jq program (first non-flag token), or None in -f /
    # --run-tests file mode / flag-only argv. Value flags consume
    # theirs (--arg=x still takes its value next, --indent
    # takes one word); -L is rejected by the caller.
    vals2 = {"--arg", "--argjson", "--slurpfile", "--rawfile"}
    vals2_eq = tuple(v + "=" for v in vals2)
    i = 0
    while i < len(rest):
        tok = rest[i]
        if tok == "--run-tests" \
                or tok.startswith("--run-tests="):
            return None
        if tok in ("-f", "--from-file") \
                or tok.startswith("--from-file=") \
                or tok.startswith("-f") and len(tok) > 2:
            return None
        if tok == "--":
            return rest[i + 1] if i + 1 < len(rest) else None
        if tok in vals2:
            i += 3
        elif tok.startswith(vals2_eq):
            i += 2
        elif tok == "--indent":
            i += 2
        elif tok.startswith("--indent="):
            i += 1
        elif tok.startswith("-") and len(tok) > 1:
            i += 1
        else:
            return tok
    return None


def _check_jq(rest, drift):
    # --run-tests evaluates test programs from a file operand
    # (mismatch diagnostics print token fragments); a test
    # mode with no legit token-helper use, rejected outright.
    if any(tok == "--run-tests"
           or tok.startswith("--run-tests=")
           for tok in rest) \
            and "helper-untrusted-exec" not in drift:
        drift.append("helper-untrusted-exec")
    for i, tok in enumerate(rest):
        target = None
        if tok in ("-f", "--from-file") \
                and i + 1 < len(rest):
            target = rest[i + 1]
        elif tok.startswith("--from-file="):
            target = tok[len("--from-file="):]
        elif tok.startswith("-f") and len(tok) > 2:
            target = tok[2:]
        if target is not None \
                and not re.match(SCRIPT_PIN, target) \
                and "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
            break
    # -L sources unpinned module dirs (none used today); the
    # inline program scans for env access like -f files do.
    if any(tok in ("-L", "--library-path")
           or tok.startswith("--library-path=")
           or re.fullmatch(r"-[a-zA-Z]*L[a-zA-Z]*", tok)
           for tok in rest) \
            and "helper-jq-env" not in drift:
        drift.append("helper-jq-env")
    prog = _jq_program(rest)
    if prog is not None and jq_program_has_env(prog) \
            and "helper-jq-env" not in drift:
        drift.append("helper-jq-env")
