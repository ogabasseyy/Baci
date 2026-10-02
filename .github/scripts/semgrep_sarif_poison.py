"""Loader/startup-variable guards: direct, declaration, and
indirect (printf/read/getopts/mapfile) assignment to PATH-family
variables. Bare export of a poison name needs no rule: every
dangerous value flows through an assignment this module (or
the bare-assign scan) already drifts.
"""
import re
from semgrep_sarif_shell import ENV_POISON


def _base(word):
    # Leading identifier: a[0] -> a (subscript writes still
    # bind the name); malformed names fail closed when they
    # start with a poison identifier.
    m = re.match(r"[A-Za-z_][A-Za-z0-9_]*", word)
    return m.group(0) if m else ""


def _read_names(rest):
    # Variable names read assigns: flag values skipped, -a
    # arrays count, stops at redirects.
    names, i, n = [], 0, len(rest)
    while i < n:
        tok = rest[i]
        if tok == "--":
            i += 1
            break
        if not tok.startswith("-") or len(tok) == 1 \
                or tok.startswith("--"):
            break
        j, consumed = 1, False
        while j < len(tok):
            if tok[j] in "adinNptu":
                if tok[j] == "a":
                    if j + 1 < len(tok):
                        names.append(tok[j + 1:])
                    elif i + 1 < n:
                        names.append(rest[i + 1])
                        consumed = True
                elif j + 1 >= len(tok):
                    consumed = True
                break
            j += 1
        i += 2 if consumed else 1
    while i < n:
        if re.match(r"^\d*[<>]", rest[i]):
            break
        names.append(rest[i])
        i += 1
    return names


def _mapfile_name(rest):
    # Assigned array, or "" for the default MAPFILE. -c/-C/-d/
    # -n/-O/-s/-u consume values (rest-of-token or next).
    i, n = 0, len(rest)
    while i < n:
        tok = rest[i]
        if tok == "--":
            i += 1
            break
        if not tok.startswith("-") or len(tok) == 1 \
                or tok.startswith("--"):
            break
        j, consumed = 1, False
        while j < len(tok):
            if tok[j] in "cCdnsOu":
                if j + 1 >= len(tok):
                    consumed = True
                break
            j += 1
        i += 2 if consumed else 1
    if i < n and not re.match(r"^\d*[<>]", rest[i]):
        return rest[i]
    return ""


def _indirect_poison(argv0, rest, drift):
    hit = False
    if argv0 == "printf":
        hit = len(rest) > 1 and rest[0] == "-v" \
            and _base(rest[1]) in ENV_POISON
    elif argv0 == "read":
        hit = any(_base(w) in ENV_POISON
                  for w in _read_names(rest))
    elif argv0 == "getopts":
        i = 0
        if rest[:1] == ["-a"]:
            i = 2
        elif rest and rest[0].startswith("-a"):
            i = 1
        hit = len(rest) > i + 1 \
            and _base(rest[i + 1]) in ENV_POISON
    elif argv0 in ("mapfile", "readarray"):
        hit = _base(_mapfile_name(rest)) in ENV_POISON
    if hit and "helper-env-poison" not in drift:
        drift.append("helper-env-poison")


def _check_poison_assign(pre, argv0, rest, drift):
    # Loader/startup rebinding in prefix assigns or declaration
    # builtins. Two safe idioms pass: IFS= scoped to read (a
    # builtin, so no resolution happens under it) and local
    # IFS (function-scoped, restored on return).
    for word in pre:
        m = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)",
                         word)
        if not m or m.group(1) not in ENV_POISON:
            continue
        if m.group(1) == "IFS" and argv0 == "read":
            continue
        if "helper-env-poison" not in drift:
            drift.append("helper-env-poison")
    if argv0 in ("export", "local", "readonly", "declare",
                "typeset"):
        i = 0
        while i < len(rest) and rest[i].startswith("-") \
                and "=" not in rest[i]:
            i += 1
        for word in rest[i:]:
            m = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)",
                             word)
            if not m:
                continue
            if m.group(1) not in ENV_POISON:
                continue
            if argv0 == "local" and m.group(1) == "IFS":
                continue
            if "helper-env-poison" not in drift:
                drift.append("helper-env-poison")
    _indirect_poison(argv0, rest, drift)


def audit_env_dump(argv0, rest, drift):
    # Environment disclosure: printenv always prints, bare
    # export/declare/typeset/readonly/local/set dump state,
    # and -p prints values. Assignments, flags (set -p is
    # privileged-mode, not a dump), and -f code listings pass.
    if "helper-env-dump" in drift:
        return
    if argv0 == "printenv" or not rest:
        drift.append("helper-env-dump")
        return
    if argv0 == "set":
        return
    for tok in rest:
        if tok in ("-p", "-P"):
            break
        if re.fullmatch(r"-[a-zA-Z]+", tok) and "p" in tok:
            break
    else:
        return
    drift.append("helper-env-dump")
