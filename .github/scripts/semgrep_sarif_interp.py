"""Helper command dispatch: interpreter operand binding,
execution wrappers, privilege primitives, and loader/startup
rebinding for token-bearing helper content.
"""
import re
from semgrep_sarif_copy import (COPY_TOOLS, audit_copy_dest,
                                audit_find_output)
from semgrep_sarif_embeds import _check_awk, _check_perl
from semgrep_sarif_git import audit_git
from semgrep_sarif_pins import (RUNNER_PIN, SCRIPT_PIN,
                                _safe_exec_path, _ws_rooted)
from semgrep_sarif_poison import audit_env_dump
from semgrep_sarif_programs import jq_program_has_env
from semgrep_sarif_shell import (ENV_POISON, peel_prefix,
                                 script_operand)
from semgrep_sarif_xargs import audit_xargs


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

# Build/package/container/provisioner drivers: each executes
# repo-controlled files. Canonical names only (variants fail at
# exec when absent); mix/stack/rake/port excluded (prose words).
LOAD_DENY = {"ansible", "ansible-playbook", "apt", "apt-get", "apk",
             "bazel", "bazelisk", "bmake", "brew", "buck2", "bun",
             "bundle", "cargo", "choco", "cmake", "conda", "crictl",
             "ctest", "ctr", "deno", "dnf", "docker", "flatpak",
             "gem", "gmake", "go", "gradle", "gradlew", "guix",
             "hatch", "helm", "installer", "invoke", "just",
             "kubectl", "mamba", "make", "meson", "micromamba",
             "msiexec", "mvn", "mvnw", "nerdctl", "ninja", "nix",
             "nox", "npm", "npx", "pacman", "pants", "pex", "pip",
             "pip3", "pipx", "pkg", "pkg_add", "pnpm", "podman",
             "poetry", "remake", "rustc", "sbt", "snap", "task",
             "terraform", "tofu", "tox", "uv", "vagrant", "winget",
             "yarn", "yum", "zypper", "composer", "conan", "pmake"}


def _check_command(argv0, rest, pre, drift, src=""):
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
            and not (src == "install.sh" and base == "curl") \
            and "helper-network-tool" not in drift:
        drift.append("helper-network-tool")
    if base in LOAD_DENY \
            and "helper-code-loader" not in drift:
        drift.append("helper-code-loader")
    if base in COPY_TOOLS:
        audit_copy_dest(base, rest, drift, src)
    elif base == "alias":
        # Alias definitions hide command dispatch (alias
        # leak='bash evil' + leak runs with no visible argv0).
        # Bare alias/name queries are read-only and pass.
        if any("=" in tok for tok in rest) \
                and "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
    elif base == "shopt":
        # Only expand_aliases matters: it arms alias
        # expansion in scripts (off by default). Query forms
        # (no -s), -o set-o names, and other options pass.
        flags = [t for t in rest
                 if re.fullmatch(r"-[a-zA-Z]+", t)]
        names = [t for t in rest if t not in flags]
        if "-o" not in flags \
                and any("s" in f[1:] for f in flags) \
                and "expand_aliases" in names \
                and "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
    elif base in ("at", "batch", "crontab", "watch"):
        # Scheduled/repeated execution with no legitimate
        # helper use (list/query spellings drift too: fail
        # closed, reviewer whitelists if ever needed).
        if "helper-deferred-exec" not in drift:
            drift.append("helper-deferred-exec")
    elif base in ("bash", "sh", "source", "."):
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
    elif base in ("python", "python3", "node", "ruby", "php",
                  "lua", "luajit"):
        # No helper uses these today; any use fails closed for
        # human review with an auditor lockstep update.
        if "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
    elif base == "env":
        _check_env(rest, drift, src)
    elif base == "find":
        if any(t in ("-exec", "-execdir", "-ok", "-okdir",
                     "-delete")
               for t in rest) \
                and "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
        audit_find_output(rest, drift)
    elif base == "git":
        audit_git(rest, drift)
    elif base in ("printenv", "export", "declare", "typeset",
                  "readonly", "local", "set"):
        audit_env_dump(base, rest, drift)
    elif base == "xargs":
        audit_xargs(rest, drift, src, _check_command)
    elif base in ("nice", "nohup", "stdbuf", "setsid", "parallel",
                  "flock", "chrt", "ionice", "taskset", "sg",
                  "tmux", "screen"):
        # Execution wrappers obscure the real argv0; none is used
        # today, so any use fails closed (exotics stay residual).
        if "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
    elif base in ("unshare", "chroot", "nsenter"):
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


def _check_env(rest, drift, src=""):
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
        # No command: env dumps the environment (stdout, pipe,
        # or redirect) instead of executing. --help and signal
        # listings dump too; fail closed.
        if "helper-env-dump" not in drift:
            drift.append("helper-env-dump")
        return
    tail = rest[i:]
    argv0, cmd_rest = peel_prefix(tail)
    if not argv0:
        return
    pre = tail[:len(tail) - len(cmd_rest) - 1]
    _check_command(argv0, list(cmd_rest), list(pre), drift,
                   src)
