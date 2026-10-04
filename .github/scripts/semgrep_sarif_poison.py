"""Loader/startup-variable guards: direct, declaration, and
indirect (printf/read/getopts/mapfile) assignment to PATH-family
variables. Runner command-file values ($GITHUB_ENV/$GITHUB_PATH)
live in semgrep_sarif_cmdfile. Bare export of a poison name
needs no rule: every dangerous value flows through an
assignment this module (or the bare-assign scan) already drifts.
"""
import re
from semgrep_sarif_consts import (ENV_POISON,
                                  is_bash_func_key)


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


def _indirect_poison(argv0, rest, drift, names=ENV_POISON,
                     label="helper-env-poison"):
    hit = False
    if argv0 == "printf":
        hit = len(rest) > 1 and rest[0] == "-v" \
            and _base(rest[1]) in names
    elif argv0 == "read":
        hit = any(_base(w) in names
                  for w in _read_names(rest))
    elif argv0 == "getopts":
        i = 0
        if rest[:1] == ["-a"]:
            i = 2
        elif rest and rest[0].startswith("-a"):
            i = 1
        hit = len(rest) > i + 1 \
            and _base(rest[i + 1]) in names
    elif argv0 in ("mapfile", "readarray"):
        hit = _base(_mapfile_name(rest)) in names
    if hit and label not in drift:
        drift.append(label)


def audit_promptfile_rebind(argv0, rest, drift):
    # printf -v/read/getopts/mapfile build values the audit
    # cannot see: any indirect bind of prompt_file rebinds the
    # model prompt path and drifts (the = forms pin above).
    _indirect_poison(argv0, rest, drift, ("prompt_file",),
                     "helper-promptfile-rebind")


def _check_poison_assign(pre, argv0, rest, drift):
    # Loader/startup rebinding in prefix assigns or declaration
    # builtins. Two safe idioms pass: IFS= scoped to read (a
    # builtin, so no resolution happens under it) and local
    # IFS (function-scoped, restored on return).
    for word in pre:
        m = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*"
                         r"|BASH_FUNC_\S+%%)(\[.*\])?\+?=(.*)",
                         word)
        if not m or (m.group(1) not in ENV_POISON
                     and not is_bash_func_key(m.group(1))):
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
            m = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*"
                             r"|BASH_FUNC_\S+%%)(\[.*\])?\+?="
                             r"(.*)", word)
            if not m:
                continue
            if m.group(1) not in ENV_POISON \
                    and not is_bash_func_key(m.group(1)):
                continue
            if argv0 == "local" and m.group(1) == "IFS":
                continue
            if "helper-env-poison" not in drift:
                drift.append("helper-env-poison")
    _indirect_poison(argv0, rest, drift)


_PS_VALUE_OPTS = {"U", "-u", "--user", "-U", "-p", "--pid",
                  "-C", "-G", "-g", "--group", "-s", "--sid",
                  "-t", "--tty", "-q", "-o", "--format", "-O",
                  "--sort"}


def audit_ps_env(rest, drift):
    # ps shows process environments only via the BSD e option
    # (ps e, auxe: no dash -- ps --help all defines e as "show
    # the environment after command"): SysV -e selects all
    # processes without disclosure, so dashed words never
    # match. Selection/format values (-u user, -o etime) are
    # skipped: a username containing e is not the e option.
    if "helper-env-dump" in drift:
        return
    i = 0
    while i < len(rest):
        tok = rest[i]
        if tok in _PS_VALUE_OPTS:
            i += 2
        elif tok.startswith("-"):
            i += 1
        elif re.fullmatch(r"[A-Za-z]+", tok) and "e" in tok:
            drift.append("helper-env-dump")
            return
        else:
            i += 1


def _is_env_dump(argv0, rest):
    # True when the builtin call discloses variable values:
    # printenv always prints; bare calls dump state; -p prints
    # values; and flags with no names (declare -x) display
    # every variable (verified: declare -x and bare local in
    # a function both print). Assignments and named operands
    # pass, set -p is privileged-mode (not a dump), and -f
    # with no names lists functions (code, not values).
    if argv0 == "printenv" or not rest:
        return True
    if argv0 == "set":
        return False
    if any(("$" in tok or "`" in tok)
           and not re.match(r"[A-Za-z_]\w*(\[[^\]]*\])?\+?=",
                            tok)
           for tok in rest):
        # An unresolved word can expand to -p (printf -v p
        # %s -p; declare "$p" GH_TOKEN prints the token);
        # static NAME=/NAME+= (or subscript) assignments
        # cannot be flags.
        return True
    for tok in rest:
        if tok in ("-p", "-P"):
            return True
        if re.fullmatch(r"-[a-zA-Z]+", tok) and "p" in tok:
            return True
    if any(re.fullmatch(r"[+-][a-zA-Z]+", tok)
           and "f" in tok[1:] for tok in rest):
        return False
    return not any(not re.fullmatch(r"[+-][a-zA-Z]+", tok)
                   and tok != "--" for tok in rest)


def audit_env_dump(argv0, rest, drift):
    # Environment disclosure via _is_env_dump (see above).
    if "helper-env-dump" in drift:
        return
    if _is_env_dump(argv0, rest):
        drift.append("helper-env-dump")
