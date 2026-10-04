"""AWK invocation audit: program-file pinning (-f/-E and
long/abbreviated spellings), debugger rejection (-D/--debug),
extension loading (-W/--load), inplace/input zoning, and
inline-program content checks. Split from semgrep_sarif_embeds
(300-line limit).
"""
import re

from semgrep_sarif_embeds import _zone_target
from semgrep_sarif_pins import SCRIPT_PIN


def _scan_awk_program(prog, drift):
    # Inline awk executes: system(), |& coprocesses, pipe
    # getlines/prints, and program redirects into zoned paths.
    # Strings blank first (regex alternation and "a|b" pass);
    # dynamic targets fail closed upward; getline-from-file,
    # /dev/stdout, and || pass.
    for m in re.finditer(r">{1,2}\s*\"((?:[^\"\\]|\\.)*)\"",
                         prog):
        _zone_target(m.group(1), drift)
    code = re.sub(r"\"(?:[^\"\\]|\\.)*\"", "\"\"", prog)
    if re.search(r"(?<![\w$])system\s*\(|\|&"
                 r"|(?<!\|)\|(?!\|)\s*getline\b"
                 r"|(?<!\|)\|(?!\|)\s*\"", code) \
            and "helper-untrusted-exec" not in drift:
        drift.append("helper-untrusted-exec")
    if re.search(r">{1,2}\s*[^\"\s=]", code) \
            and "helper-trusted-write" not in drift:
        drift.append("helper-trusted-write")


# Long-option dispatch for the abbreviation engine: gawk
# accepts any unique prefix (= or separate word for the
# value), so --ex/--fil/--debu reach the same file/debug
# paths as their full spellings. Ambiguous (--fi: file vs
# field-separator) or unknown longs are fatal to gawk (dead
# code) and skip like other unknown flags. Table gaps fail
# closed (an omitted name can only turn dead-ambiguous
# into a drift, never the reverse).
_LONG_OPTS = {"assign": "cons2", "bignum": "skip",
              "characters-as-bytes": "skip", "copyright": "skip",
              "debug": "debug", "dump-variables": "dump",
              "exec": "file", "field-separator": "cons2",
              "file": "file", "gen-pot": "dump", "help": "skip",
              "include": "load", "lint": "skip", "lint-old": "skip",
              "load": "load", "optimize": "skip",
              "pretty-print": "zoneq", "profile": "zoneq",
              "sandbox": "skip", "source": "scan",
              "traditional": "skip", "use-lc-numeric": "skip",
              "version": "skip"}


def _awk_long_step(tok, rest, i, drift):
    # Words consumed by one --long token (exact or abbreviated).
    # Separate-word values apply only to required-value options
    # (getopt_long takes optional values via = only), so bare
    # --pretty-print/--profile/--lint leave the program word
    # for the positional scan.
    if "=" in tok:
        name, arg = tok[2:].split("=", 1)
        attached = True
    else:
        name, arg, attached = tok[2:], "", False
    cands = [n for n in _LONG_OPTS if n.startswith(name)]
    if len(cands) != 1:
        return 1
    kind = _LONG_OPTS[cands[0]]
    if kind == "file":
        if attached:
            target, step = arg, 1
        elif i + 1 < len(rest):
            target, step = rest[i + 1], 2
        else:
            return 1
        if not re.match(SCRIPT_PIN, target) \
                and "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
        return step
    if kind == "debug" or kind == "load":
        # Debugger command files (and stdin) execute; --load
        # runs extension DSO constructors; --include reads a
        # program file. None is legit in a token helper.
        if "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
        return 2 if not attached and i + 1 < len(rest) else 1
    if kind == "cons2":
        return 1 if attached else 2
    if kind == "zoneq":
        if attached:
            _zone_target(arg, drift)
        return 1
    if kind == "scan":
        if attached:
            _scan_awk_program(arg, drift)
            return 1
        if i + 1 < len(rest):
            _scan_awk_program(rest[i + 1], drift)
        return 2
    if kind == "dump":
        # Variable/pot dumps default into the helper CWD
        # (workspace unless cd'd); = forms zone precisely.
        if attached:
            _zone_target(arg, drift)
            return 1
        if "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
        return 1
    return 1


def _check_awk(rest, drift):
    # -f/-E program files must be pinned; the positional
    # program, -e/--source programs take content checks (they
    # execute); input files are data. -i inplace rewrites its
    # file operands, so those take the write-zone rule (VAR=
    # operands are assignments, data).
    i, inplace, program_seen = 0, False, False
    while i < len(rest):
        tok = rest[i]
        if tok == "--":
            i += 1
            continue
        if tok.startswith("-W"):
            # -W smuggles a gawk option (debug, exec, file,
            # source, profile) past the parser with no legit
            # helper use; any use fails closed.
            if "helper-untrusted-exec" not in drift:
                drift.append("helper-untrusted-exec")
            return
        if (tok.startswith("-o") or tok.startswith("-p")) \
                and len(tok) > 2:
            _zone_target(tok[2:], drift)
            i += 1
        elif tok in ("-o", "-p"):
            # Default awkprof.out lands in the helper CWD
            # (workspace unless cd'd); profiling has no
            # legit token-helper use.
            if "helper-untrusted-exec" not in drift:
                drift.append("helper-untrusted-exec")
            return
        elif tok in ("-f", "--file", "-E", "--exec") \
                and i + 1 < len(rest):
            if not re.match(SCRIPT_PIN, rest[i + 1]) \
                    and "helper-untrusted-exec" not in drift:
                drift.append("helper-untrusted-exec")
                return
            i += 2
        elif (tok.startswith("-f") or tok.startswith("-E")) \
                and len(tok) > 2:
            if not re.match(SCRIPT_PIN, tok[2:]) \
                    and "helper-untrusted-exec" not in drift:
                drift.append("helper-untrusted-exec")
                return
            i += 1
        elif tok.startswith(("--file=", "--exec=")):
            if not re.match(SCRIPT_PIN,
                             tok.split("=", 1)[1]) \
                    and "helper-untrusted-exec" not in drift:
                drift.append("helper-untrusted-exec")
                return
            i += 1
        elif tok == "--source" \
                or tok.startswith("--source="):
            if tok == "--source":
                if i + 1 < len(rest):
                    _scan_awk_program(rest[i + 1], drift)
                i += 2
            else:
                _scan_awk_program(tok[len("--source="):], drift)
                i += 1
        elif tok.startswith("-e") and len(tok) > 2:
            _scan_awk_program(tok[2:], drift)
            program_seen = True
            i += 1
        elif tok == "-i":
            # Bare -i takes an include file: only the inplace
            # extension is known-safe (unpinned code otherwise).
            nxt = rest[i + 1] if i + 1 < len(rest) else ""
            if nxt.startswith("inplace"):
                inplace = True
                i += 2
            elif nxt == "" or nxt == "--" \
                    or nxt.startswith("-"):
                i += 1
            else:
                if "helper-untrusted-exec" not in drift:
                    drift.append("helper-untrusted-exec")
                return
        elif tok in ("--inplace",) \
                or tok.startswith("--inplace="):
            inplace = True
            i += 1
        elif tok.startswith("-i"):
            if tok[2:].startswith("inplace"):
                inplace = True
                i += 1
            else:
                if "helper-untrusted-exec" not in drift:
                    drift.append("helper-untrusted-exec")
                return
        elif tok.startswith("-D") or tok == "--debug" \
                or tok.startswith("--debug=") \
                or (re.fullmatch(r"-[A-Za-z]+", tok)
                    and "D" in tok
                    and not tok.startswith(("-v", "-F", "-e"))):
            # The debugger executes command files (and piped
            # stdin); never legit in a token helper. -o/-p
            # attached values zone above, so -oD/-pD stay
            # precise; -LD is an invalid lint value (dead).
            if "helper-untrusted-exec" not in drift:
                drift.append("helper-untrusted-exec")
            return
        elif tok in ("-v", "-F"):
            i += 2
        elif tok.startswith("--"):
            i += _awk_long_step(tok, rest, i, drift)
        elif tok.startswith("-"):
            i += 1
        elif not program_seen:
            program_seen = True
            _scan_awk_program(tok, drift)
            i += 1
        elif inplace and not re.fullmatch(
                r"[A-Za-z_][A-Za-z0-9_]*=.*", tok):
            _zone_target(tok, drift)
            i += 1
        else:
            i += 1
