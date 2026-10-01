"""Per-step command guards: secret/loose argv0 allowlists with git
confinement, PATH-family hijack rejection, and the no-token-
expression rule for the agent step and job environment.
"""
import re
from semgrep_sarif_scan import (is_trusted_write_target,
                                    redirect_targets)
from semgrep_sarif_shell import (ENV_POISON, SHELL_KEYWORDS,
                                 STRICT_ALLOW, is_step_boundary,
                                 peel_prefix, run_segments,
                                 split_commands2, step_end,
                                 tokenize, unquote)

def audit_step_commands(ctx, drift):

    # (d) Per-step command allowlists. Secret-bearing steps
    # (derived: any secrets. reference in the span, so an aliased
    # token auto-escalates its step) plus the integrity-critical
    # installer step take STRICT_ALLOW; remaining steps take that
    # plus git/rm (the collision step's tools). Every step
    # inherits runner runtime tokens, so even secretless steps
    # cannot run exfil-capable commands. Unknown interpreters,
    # direct executables, eval/traps/aliases, and sudo in any
    # step all drift, as does any redirect into the trusted
    # tree (a resolver git cat-file piped there would rewrite
    # trusted scripts at runtime). PATH-family assignment would
    # hijack later argv0 resolution within the step, so it
    # drifts in secret steps too. Residual: rm operands
    # (runner-local DoS only; no secrets or consumed outputs in
    # rm-bearing steps).
    secret_ref = re.compile(
        r"secrets\s*\.\s*[A-Za-z_]\w*|github\s*\.\s*token\b",
        re.IGNORECASE)
    LOOSE_ALLOW = STRICT_ALLOW | {"git", "rm"}
    GIT_SAFE_FLAGS = {"--no-pager", "-v", "--version", "-h",
                      "--help"}
    GIT_DANGER_FLAGS = {"-c", "--config", "--config-env",
                        "--exec-path", "-p", "--paginate",
                        "--git-dir", "--work-tree"}
    GIT_READ_SUBCOMMANDS = {"cat-file", "help", "version"}
    poison_alt = "(?:" + "|".join(ENV_POISON) + ")"
    assign_prefix = (r"(?:^|[;&|])\s*(?:[A-Za-z_][A-Za-z0-9_]*"
                     r"=\S+\s+)*")
    builtin_prefix = (r"(?:(?:export|local|readonly|declare|"
                      r"typeset)\s+(?:-\S+\s+)*)?"
                      r"(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*")
    bounds = [i for i, line in enumerate(ctx.workflow_lines)
              if is_step_boundary(line)] + [len(ctx.workflow_lines)]
    for k in range(len(bounds) - 1):
        span = ctx.workflow_lines[bounds[k]:bounds[k + 1]]
        name_m = re.match(r"^\s*-\s*name:\s*(.+)$",
                          span[0].strip())
        step_name = name_m.group(1).strip() if name_m else ""
        strict = step_name == "Install Muse Code" or any(
            secret_ref.search(line) for line in span)
        allowed = STRICT_ALLOW if strict else LOOSE_ALLOW
        for seg in run_segments(span):
            for tgt in redirect_targets(seg):
                if is_trusted_write_target(tgt) \
                        and "step-trusted-write" not in drift:
                    drift.append("step-trusted-write")
            code = re.sub(r"'[^']*'", "''", seg)
            if strict and re.search(
                    assign_prefix + builtin_prefix
                    + poison_alt + r"\s*=", code) \
                    and "secret-step-path-hijack" not in drift:
                drift.append("secret-step-path-hijack")
            if re.search(
                    assign_prefix + r"(?:sudo|doas)\b", code) \
                    and "secret-step-untrusted-command" not in drift:
                drift.append("secret-step-untrusted-command")
            masked = re.sub(r"\[\[.*?\]\]", "[[ ]]", code)
            masked = re.sub(r"\(\(.*?\)\)", "(())", masked)
            # The git -C check below compares this variable's value,
            # so it survives masking (anything else would accept
            # `-C "${EVIL}"` via the masked placeholder).
            masked = re.sub(
                r"\$\{[^{}]*\}",
                lambda m: m.group(0)
                if m.group(0) == "${GITHUB_WORKSPACE}" else "${}",
                masked)
            masked = re.sub(
                r"[A-Za-z_][A-Za-z0-9_]*\(\)\s*\{?", "", masked)
            for piece, after_open, at_close in \
                    split_commands2(masked):
                if at_close and not after_open:
                    continue
                words = [unquote(t) for t in tokenize(piece)]
                if not words:
                    continue
                argv0, rest = peel_prefix(words)
                if not argv0 or argv0 in SHELL_KEYWORDS \
                        or argv0 in ("for", "select", "case"):
                    continue
                if re.match(r"^[\*\?\[]", argv0) \
                        or re.match(r"^\d*[<>]", argv0):
                    continue
                if argv0 not in allowed \
                        and "secret-step-untrusted-command" \
                        not in drift:
                    drift.append("secret-step-untrusted-command")
                if argv0 == "git":
                    # git reads only, from the workspace: no config
                    # injection, no pager exec, no path redirect,
                    # no fetch/write subcommands, and no
                    # filter/textconv execution via subcommand args.
                    i = 0
                    sub = None
                    bad_git = False
                    while i < len(rest):
                        tok = rest[i]
                        if tok in GIT_DANGER_FLAGS:
                            bad_git = True
                            break
                        if tok in GIT_SAFE_FLAGS:
                            i += 1
                        elif tok == "-C":
                            nxt = rest[i + 1] if i + 1 < len(rest) \
                                else ""
                            nxt = nxt.rstrip("/")
                            if nxt != "${GITHUB_WORKSPACE}" \
                                    and not nxt.startswith(
                                        "${GITHUB_WORKSPACE}/"
                                        "trusted-scripts"):
                                bad_git = True
                                break
                            i += 2
                        elif tok.startswith("-"):
                            bad_git = True
                            break
                        else:
                            sub = tok
                            i += 1
                            break
                    if not bad_git and sub is not None:
                        if sub not in GIT_READ_SUBCOMMANDS:
                            bad_git = True
                        elif any(a in ("--filters", "--textconv")
                                 for a in rest[i:]):
                            bad_git = True
                    if bad_git and "secret-step-untrusted-command" \
                            not in drift:
                        drift.append("secret-step-untrusted-command")


def audit_agent_env(ctx, drift):
    # The runner scrubs only the two conventional token variable
    # names: a token passed to the agent step under another key (or
    # via job-level env, which the step inherits) would survive into
    # the third-party process. Forbid token expressions in both.
    token_expr = re.compile(
        r"secrets\s*\.\s*github_token\b|github\s*\.\s*token\b",
        re.IGNORECASE)
    agent_step = [i for i, line in enumerate(ctx.workflow_lines)
                  if re.match(r"^- name:\s*Run Muse review\s*$",
                              line.strip())]
    agent_span = []
    if agent_step:
        s = agent_step[0]
        agent_span = ctx.workflow_lines[s:step_end(ctx.workflow_lines, s)]
    else:
        drift.append("agent-step-missing")
    job_env = []
    in_env = False
    for line in ctx.code_lines:
        # Job-level env: is 4-space (jobs.<name>.env); step-level
        # is 8-space and must not start a job-env region.
        if re.match(r"^    env:\s*$", line):
            in_env = True
        elif re.match(r"^  \S|^    \S", line):
            in_env = False
        elif in_env:
            job_env.append(line)
    for line in agent_span + job_env:
        if token_expr.search(line):
            drift.append("agent-token-expression")
            break
