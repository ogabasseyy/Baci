"""Helper command dispatch: interpreter operand binding,
execution wrappers, privilege primitives, and loader/startup
rebinding for token-bearing helper content.
"""
import re
from semgrep_sarif_archive import (ARCHIVE_TOOLS,
                                   audit_archive_dest)
from semgrep_sarif_binutils import _canon_binutils
from semgrep_sarif_copy import (COPY_TOOLS, audit_copy_dest)
from semgrep_sarif_findout import audit_find_output
from semgrep_sarif_embeds import _check_perl
from semgrep_sarif_awk import _check_awk
from semgrep_sarif_gh import audit_gh
from semgrep_sarif_git import audit_git
from semgrep_sarif_pins import (RUNNER_PIN,
                                _safe_exec_path, _ws_rooted,
                                script_operand)
from semgrep_sarif_poison import audit_env_dump, audit_ps_env
from semgrep_sarif_jq import _check_jq
from semgrep_sarif_consts import (ENV_POISON, LOAD_DENY,
                                  NET_DENY, _GCC_RE, _LD_SO_RE,
                                  _TCL_RE, _TIDY_RE)
from semgrep_sarif_install import _installer_curl_ok
from semgrep_sarif_peel import peel_prefix
from semgrep_sarif_xargs import audit_xargs
from semgrep_sarif_zone import audit_cd


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
            and not (src == "install.sh" and base == "curl"
                     and _installer_curl_ok(rest)) \
            and "helper-network-tool" not in drift:
        drift.append("helper-network-tool")
    if (base in LOAD_DENY or _GCC_RE.match(base)
            or _LD_SO_RE.match(base) or _TCL_RE.match(base)
            or _TIDY_RE.match(base)) \
            and "helper-code-loader" not in drift:
        drift.append("helper-code-loader")
    if ((_canon_binutils(base) or base)
            in ("ld", "nm", "ar", "ranlib")
            and any(tok in ("-plugin", "--plugin")
                    or tok.startswith("--plugin=")
                    for tok in rest)) \
            and "helper-code-loader" not in drift:
        # These binutils only read/write their zoned operands,
        # but --plugin loads a DSO whose constructor runs
        # first (nm --plugin evil.so reads GH_TOKEN).
        # -plugin is ld-only; the shared tuple over-approxes
        # its siblings fail-closed (invalid there: reviewer
        # sees drift on an already broken line).
        drift.append("helper-code-loader")
    if base in COPY_TOOLS or _canon_binutils(base):
        audit_copy_dest(base, rest, drift, src)
    elif base in ARCHIVE_TOOLS:
        audit_archive_dest(rest, drift)
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
    elif base in ("cd", "pushd", "popd"):
        audit_cd(base, rest, drift)
    elif base in ("bash", "sh", "source", ".", "dash", "ash",
                  "zsh", "ksh", "mksh", "pdksh", "lksh", "yash",
                  "fish", "tcsh", "csh"):
        # Alternate shells bind like bash (busybox stays in
        # NET_DENY: its multi-call form obscures argv0).
        bound = script_operand(rest, base)
        if not bound and base in ("source", ".") and rest \
                and re.match(RUNNER_PIN, rest[0]):
            # Sourcing inter-phase env files (%q-quoted by
            # collect.sh) is the designed state handoff.
            bound = True
        if not bound \
                and "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
    elif base == "perl" or re.fullmatch(r"perl\d[\w.+-]*",
                                            base):
        # Versioned/target-qualified perl (perl5.38.2,
        # perl5.38-x86_64-linux-gnu) audits like perl; the
        # digit right after perl keeps perldoc/perlbug out.
        _check_perl(rest, drift)
    elif base == "jq":
        _check_jq(rest, drift)
    elif base == "gh":
        audit_gh(rest, drift)
    elif base == "awk" or re.fullmatch(
            r"(mawk|nawk|gawk|oawk|original-awk)(-\d[\d.]*)?",
            base):
        # AWK aliases (and distro-versioned spellings) audit
        # like awk; -v assignments are part of the program.
        _check_awk(rest, drift)
    elif base in ("python", "python3", "node", "ruby", "php",
                  "lua", "luajit") \
            or re.fullmatch(r"python\d+(\.\d+)*", base):
        # No helper uses these today; any use fails closed for
        # human review with an auditor lockstep update.
        # Version-suffixed python (python3.12) shares the
        # file-operand mechanism.
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
    elif base == "ps":
        audit_ps_env(rest, drift)
    elif base in ("envsubst", "eval_gettext", "eval_ngettext"):
        # Runtime environment disclosure: single-quoted
        # operands skip the static secret scan but expand
        # live values into agent-bound files. No legit
        # token-helper use; any use fails closed.
        if "helper-secret-expand" not in drift:
            drift.append("helper-secret-expand")
    elif base == "xargs":
        audit_xargs(rest, drift, src, _check_command)
    elif base in ("nice", "nohup", "stdbuf", "setsid", "parallel",
                  "flock", "chrt", "ionice", "taskset", "sg",
                  "tmux", "screen", "coproc", "fakeroot",
                  "xvfb-run", "prlimit", "timeout"):
        # Execution wrappers obscure the real argv0; none is used
        # today, so any use fails closed (exotics stay residual).
        # coproc counts: it runs its command asynchronously with
        # helper tokens (command/builtin/exec/sudo peel instead,
        # so the inner argv0 audits normally).
        if "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
    elif base == "enable":
        # Dynamic builtins load attacker .so into the shell
        # (-f); disabling (-n) drops builtins to PATH lookup.
        # Queries (-p/-s/-a/-d, bare) pass; scanning stops at --.
        danger = False
        for tok in rest:
            if tok == "--":
                break
            if re.fullmatch(r"-[a-zA-Z]+", tok) \
                    and ("f" in tok or "n" in tok):
                danger = True
                break
        if danger and "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
    elif base == "hash":
        # hash -p installs an arbitrary path as a command name;
        # -r/-d/-l/-t queries and bare hash pass. Scanning stops
        # at -- (verified honored).
        danger = False
        for tok in rest:
            if tok == "--":
                break
            if re.fullmatch(r"-[a-zA-Z]+", tok) \
                    and "p" in tok:
                danger = True
                break
        if danger and "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
    elif base in ("unshare", "chroot", "nsenter"):
        if "helper-privilege" not in drift:
            drift.append("helper-privilege")
    elif base == "eval":
        # eval combines its arguments and executes the result
        # as shell commands: even static payloads run
        # PR-relative scripts (eval 'bash ./evil.sh'), so any
        # use drifts. No audited helper uses eval (verified).
        if "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")


def _check_env(rest, drift, src=""):
    # Token scrubbing legitimately uses env -u; anything else
    # routes the command back through the full dispatch. -S /
    # --split-string take their own quoting language: fail
    # closed.
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
        if tok == "--split-string" \
                or tok.startswith("--split-string="):
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
        elif re.fullmatch(r"(?:[A-Za-z_][A-Za-z0-9_]*"
                         r"|BASH_FUNC_\S+%%)=.*", tok):
            if (tok.split("=", 1)[0] in ENV_POISON
                    or re.fullmatch(r"BASH_FUNC_\S+%%",
                                    tok.split("=", 1)[0])) \
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
