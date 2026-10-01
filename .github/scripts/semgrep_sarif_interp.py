"""Helper command dispatch: interpreter operand binding,
execution wrappers, privilege primitives, and loader/startup
rebinding for token-bearing helper content.
"""
import re
from semgrep_sarif_embeds import _check_awk, _check_perl
from semgrep_sarif_pins import (RUNNER_PIN, SCRIPT_PIN,
                                _safe_exec_path, _ws_rooted)
from semgrep_sarif_programs import jq_program_has_env
from semgrep_sarif_shell import (ENV_POISON, peel_prefix,
                                 script_operand)


def _jq_program(rest):
    # Inline jq program (first non-flag token), or None in -f file
    # mode / flag-only argv. Value flags consume theirs (--arg=x
    # still takes its value next); -L is rejected by the caller.
    vals2 = {"--arg", "--argjson", "--slurpfile", "--rawfile"}
    vals2_eq = tuple(v + "=" for v in vals2)
    i = 0
    while i < len(rest):
        tok = rest[i]
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
        elif tok.startswith("-") and len(tok) > 1:
            i += 1
        else:
            return tok
    return None


# Bare network-capable commands: no audited helper needs them —
# install.sh's pinned download curl is the single exemption
# (the installer URL rule constrains its target), and gh/git
# stay allowed (load-bearing; programs audit separately). A bare
# curl/nc/ssh falls past every path rule while exfiltrating
# GH_TOKEN, so any other use drifts for human review.
NET_DENY = {"aria2c", "axel", "busybox", "curl", "ftp", "lftp",
            "mail", "msmtp", "nc", "ncat", "netcat", "nmap",
            "openssl", "scp", "sendmail", "sftp", "socat", "ssh",
            "telnet", "tftp", "rsync", "wget"}


def _check_command(argv0, rest, pre, drift, pinned_curl=False):
    if "sudo" in pre or "doas" in pre \
            or argv0 in ("su", "runuser", "setpriv"):
        if "helper-privilege" not in drift:
            drift.append("helper-privilege")
    if "/" in argv0 or argv0.startswith("./") \
            or argv0.startswith("../"):
        if not _safe_exec_path(argv0) \
                and "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
    base = argv0.rsplit("/", 1)[-1]
    if base in NET_DENY \
            and not (pinned_curl and base == "curl") \
            and "helper-network-tool" not in drift:
        drift.append("helper-network-tool")
    if base in ("bash", "sh", "source", "."):
        bound = script_operand(rest)
        if not bound and base in ("source", ".") and rest \
                and re.match(RUNNER_PIN, rest[0]):
            # Sourcing inter-phase env files (%q-quoted by
            # collect.sh) is the designed state handoff.
            bound = True
        if not bound \
                and "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
    elif base == "perl":
        _check_perl(rest, drift)
    elif base == "jq":
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
    elif base == "gh":
        # gh --jq programs are jq: scan the value, not the API path.
        for i, tok in enumerate(rest):
            prog = None
            if tok == "--jq" and i + 1 < len(rest):
                prog = rest[i + 1]
            elif tok.startswith("--jq="):
                prog = tok[len("--jq="):]
            if prog is not None and jq_program_has_env(prog) \
                    and "helper-jq-env" not in drift:
                drift.append("helper-jq-env")
                break
    elif base == "awk":
        _check_awk(rest, drift)
    elif base in ("python", "python3", "node", "ruby", "php"):
        # No helper uses these today; any use fails closed for
        # human review with an auditor lockstep update.
        if "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
    elif base == "env":
        _check_env(rest, drift, pinned_curl)
    elif base == "find":
        if any(t in ("-exec", "-execdir", "-ok", "-okdir")
               for t in rest) \
                and "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
    elif base == "xargs":
        _check_xargs(rest, drift, pinned_curl)
    elif base in ("nice", "nohup", "stdbuf", "setsid"):
        # Execution wrappers obscure the real argv0; none is
        # used today, so any use fails closed.
        if "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
    elif base in ("unshare", "chroot"):
        if "helper-privilege" not in drift:
            drift.append("helper-privilege")
    elif base == "eval":
        # Static strings pass (visible for human review);
        # anything dynamic ($, backtick, workspace-rooted)
        # drifts. Subshells extract to $() first, so the $
        # test still sees through $(...) indirection.
        if any("$" in tok or "`" in tok or _ws_rooted(tok)
               for tok in rest) \
                and "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")


def _check_env(rest, drift, pinned_curl=False):
    # Token scrubbing legitimately uses env -u; anything else
    # routes the command back through the full dispatch. -S
    # takes its own quoting language: fail closed.
    value_flags = {"-u", "-C", "--unset", "--chdir", "--argv0"}
    skip_one = {"-i", "-0", "--null", "-v", "--debug",
                "--ignore-environment", "--list-signal-handling",
                "--block-signal", "--ignore-signal",
                "--default-signal"}
    i = 0
    while i < len(rest):
        tok = rest[i]
        if tok == "--":
            i += 1
            break
        if tok.startswith("-") and not tok.startswith("--") \
                and "S" in tok[1:]:
            if "helper-untrusted-exec" not in drift:
                drift.append("helper-untrusted-exec")
            return
        if tok in value_flags:
            i += 2
        elif tok in skip_one:
            i += 1
        elif tok.startswith("--") and "=" in tok:
            i += 1
        elif re.fullmatch(r"-[a-zA-Z0-9]+", tok):
            if tok[-1] in "uC":
                i += 2
            else:
                i += 1
        elif re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", tok):
            if tok.split("=", 1)[0] in ENV_POISON \
                    and "helper-env-poison" not in drift:
                drift.append("helper-env-poison")
                return
            i += 1
        else:
            break
    if i >= len(rest):
        return
    tail = rest[i:]
    argv0, cmd_rest = peel_prefix(tail)
    if not argv0:
        return
    pre = tail[:len(tail) - len(cmd_rest) - 1]
    _check_command(argv0, list(cmd_rest), list(pre), drift,
                   pinned_curl)


def _check_xargs(rest, drift, pinned_curl=False):
    # Arguments are opaque to the invoked command, so any
    # workspace-rooted token fails closed; the command itself
    # takes the path rule. -e/-E values are ambiguous: fail
    # closed (use --eof= instead).
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
        if tok in ("-n", "-P", "-I", "-d", "-a", "-L", "-s",
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
    if ("/" in cmd or cmd.startswith(".")) \
            and not _safe_exec_path(cmd) \
            and "helper-untrusted-exec" not in drift:
        drift.append("helper-untrusted-exec")
    if cmd.rsplit("/", 1)[-1] in NET_DENY \
            and not (pinned_curl and cmd == "curl") \
            and "helper-network-tool" not in drift:
        drift.append("helper-network-tool")


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

