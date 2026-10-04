"""xargs dispatch: arguments are opaque to the invoked
command, so any workspace-rooted token fails closed; the
parsed command routes through the full dispatch (an xargs
bash/git/cp must meet the same operand rules as a direct
call). -e/-E values are ambiguous: fail closed (use --eof=
instead). --process-slot-var=<name> exports <name> to each
child, so poison names drift like env assigns.
"""
import re
from semgrep_sarif_pins import _safe_exec_path, _ws_rooted
from semgrep_sarif_consts import (ENV_POISON,
                                  is_bash_func_key)
from semgrep_sarif_varmap import audit_unresolved_argv


def audit_xargs(rest, drift, src, dispatch):
    if any(_ws_rooted(tok) for tok in rest) \
            and "helper-untrusted-exec" not in drift:
        drift.append("helper-untrusted-exec")
        return
    i = 0
    while i < len(rest):
        tok = rest[i]
        if tok == "--":
            i += 1
            break
        if re.fullmatch(r"-[a-zA-Z0-9]*[eE][a-zA-Z0-9]*",
                        tok):
            if "helper-untrusted-exec" not in drift:
                drift.append("helper-untrusted-exec")
            return
        if tok == "--process-slot-var":
            if i + 1 >= len(rest):
                if "helper-untrusted-exec" not in drift:
                    drift.append("helper-untrusted-exec")
                return
            if (rest[i + 1] in ENV_POISON
                    or is_bash_func_key(rest[i + 1])) \
                    and "helper-env-poison" not in drift:
                drift.append("helper-env-poison")
                return
            i += 2
        elif tok.startswith("--process-slot-var="):
            if (tok.split("=", 1)[1] in ENV_POISON
                    or is_bash_func_key(tok.split("=", 1)[1])) \
                    and "helper-env-poison" not in drift:
                drift.append("helper-env-poison")
                return
            i += 1
        elif tok in ("-n", "-P", "-I", "-d", "-a", "-L", "-s",
                     "--max-args", "--max-procs", "--replace",
                     "--delimiter", "--arg-file"):
            i += 2
        elif tok.startswith("--") and "=" in tok:
            i += 1
        elif re.fullmatch(r"-[a-zA-Z0-9]+", tok):
            if tok[-1] in "nPIdaLs":
                i += 2
            else:
                i += 1
        else:
            break
    if i >= len(rest):
        return
    cmd = rest[i]
    if cmd.startswith(".") and cmd not in (".", "..") \
            and "/" not in cmd and not _safe_exec_path(cmd) \
            and "helper-untrusted-exec" not in drift:
        # Bare dotfile argv0 (no ./ prefix): execvp resolves
        # it through PATH, which the path rule cannot see.
        drift.append("helper-untrusted-exec")
    # The shell expands the operand before xargs runs
    # (xargs b[as]h executes bash), so dynamic argv0s
    # re-enter here; stale is unknown on this path.
    audit_unresolved_argv(cmd, frozenset(), drift)
    dispatch(cmd, list(rest[i + 1:]), [], drift, src)
