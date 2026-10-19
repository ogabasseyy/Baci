"""Agent-invocation guards: the single muse call in run.sh
must carry standalone containment flags (values can never
masquerade as flags), scrub both GitHub tokens exactly, and
build model_args from --model pairs only.
"""
import re
from semgrep_sarif_varcollect import CARRY_VARS
from semgrep_sarif_varmap import _collect_vars, _resolve
from semgrep_sarif_words import (_dequote, _peel_env,
                                 _shell_words)
from semgrep_sarif_scan import extract_subshells
from semgrep_sarif_segments import logical_lines
from semgrep_sarif_peel import peel_prefix
from semgrep_sarif_shell import split_commands2

MUSE_VALUE_FLAGS = {"--prompt-file", "--workspace",
                    "--reasoning-effort", "--max-model-steps",
                    "--output-schema", "--model"}
MUSE_BOOL_FLAGS = {"--disable-approval", "--disable-write",
                   "--disable-shell", "--no-session-log"}


def _parse_muse_argv(rest):
    # Token-aware argv validation. Returns (seen, problem):
    # seen holds every standalone boolean flag; problem names
    # a shape violation when one exists. Redirects are skipped
    # (not argv); --opt=value keeps its value attached; value
    # flags skip the next token positionally, so a value can
    # never satisfy a containment check. Unknowns record but
    # never stop the scan (seen stays complete for the
    # containment checks); they drift for lockstep review when
    # containment itself is intact.
    seen, i, n = set(), 0, len(rest)
    if not n or rest[0] != "exec":
        return seen, "agent-subcommand"
    i, problem = 1, None
    redir = re.compile(r"^\d*(>>|>|<<|<<<|<|>&|<&)")
    while i < n:
        tok = rest[i]
        m = redir.match(tok)
        if m:
            i += 1 if len(tok) > m.end() else 2
            continue
        if tok.startswith("--"):
            name, eq, _ = tok.partition("=")
            if name not in MUSE_VALUE_FLAGS \
                    and name not in MUSE_BOOL_FLAGS:
                problem = problem or "agent-unknown-flag"
                i += 1
            elif eq:
                i += 1
            elif name in MUSE_VALUE_FLAGS:
                i += 2
            else:
                seen.add(name)
                i += 1
            continue
        if tok == "${model_args[@]}":
            # Splats invisibly: shape-audited at its
            # definition site instead.
            i += 1
            continue
        problem = problem or "agent-unknown-flag"
        i += 1
    return seen, problem


def _muse_flag_values(rest):
    # Every --workspace/--prompt-file value (separate and
    # =-attached forms): positional consumption mirrors the
    # argv parser, so a flag-shaped value still counts as a
    # value. Missing values (redirect or end next) yield
    # nothing for that occurrence.
    vals, i, n = [], 0, len(rest)
    redir = re.compile(r"^\d*(>>|>|<<|<<<|<|>&|<&)")
    while i < n:
        tok = rest[i]
        m = redir.match(tok)
        if m:
            i += 1 if len(tok) > m.end() else 2
            continue
        if tok.startswith("--"):
            name, eq, attached = tok.partition("=")
            if eq and name in ("--workspace", "--prompt-file"):
                vals.append((name, attached))
                i += 1
            elif not eq and name in ("--workspace",
                                     "--prompt-file"):
                if i + 1 < n and not redir.match(rest[i + 1]):
                    vals.append((name, rest[i + 1]))
                i += 2
            elif not eq and name in MUSE_VALUE_FLAGS:
                i += 2
            else:
                i += 1
            continue
        i += 1
    return vals


def _parse_env_scrub(piece):
    # Exact -u/--unset values. Unknown env shapes (bundles,
    # -C/-S/--argv0, combined shorts) stop the parse: the scrub
    # cannot be verified, so the gate fails closed below.
    toks = [_dequote(w) for w in _shell_words(piece)]
    if not toks or toks[0] != "env":
        return set()
    scrubbed, i, n = set(), 1, len(toks)
    while i < n:
        tok = toks[i]
        if tok == "--":
            break
        if tok == "-u" or tok == "--unset":
            if i + 1 >= n:
                return set()
            scrubbed.add(toks[i + 1])
            i += 2
        elif tok.startswith("--unset="):
            scrubbed.add(tok.split("=", 1)[1])
            i += 1
        elif tok.startswith("-u") and len(tok) > 2:
            scrubbed.add(tok[2:])
            i += 1
        elif tok in ("-i", "--ignore-environment") \
                or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*",
                                tok):
            i += 1
        else:
            break
    return scrubbed


def _check_model_args(logical, drift):
    # model_args splats invisibly into the invocation: empty
    # init plus --model appends with a single non-flag value,
    # nothing else (invisible flags would bypass the parser).
    for line in logical:
        s = re.sub(r"^(?:local|declare|export|readonly|typeset)"
                   r"\s+", "", line.strip())
        if not s.startswith("model_args"):
            continue
        if re.fullmatch(r"model_args=\(\s*\)", s):
            continue
        m = re.fullmatch(r"model_args\+?=\((.*)\)", s)
        if not m:
            break
        parts = m.group(1).split()
        if len(parts) == 2 and parts[0] == "--model":
            val = parts[1]
            if len(val) >= 2 and val[0] == val[-1] \
                    and val[0] in ("'", '"'):
                val = val[1:-1]
            if val and not val.startswith("-"):
                continue
        break
    else:
        return
    if "agent-model-args" not in drift:
        drift.append("agent-model-args")


def audit_agent_runner(drift):

    # The data-only premise rests on the agent invocation itself:
    # every muse call in the trusted runner must carry the exact
    # execution-disabling flags (comment mentions do not count) and
    # must shed the GitHub token. Backslash continuations joined.
    runner_path = ".github/scripts/muse-review/run.sh"
    try:
        with open(runner_path) as fh:
            runner_raw = fh.read().splitlines()
    except OSError:
        runner_raw = []
    if not runner_raw:
        drift.append("agent-runner-missing")
    else:
        logical = logical_lines(runner_raw)
        # Resolve top-level literal variables first: a constructed
        # path (MUSE_BIN=...muse; "${MUSE_BIN}" exec ...) must count
        # as an invocation, not slip past the literal match.
        varmap, _, namerefs, _ = _collect_vars(runner_raw)
        expanded = [_resolve(line, varmap, namerefs)
                    for line in logical]
        # Command-position words (quote-glued, env-peeled): prose
        # mentions (echo "muse ...") and identifiers (muse_rc) sit
        # off command position and never count; subshell bodies
        # recurse since $(muse ...) executes too.
        roots = "|".join(
            r"\$\{%s\}|\$%s(?![A-Za-z0-9_])" % (v, v)
            for v in CARRY_VARS)

        def calls_in(text):
            found = []
            cleaned, inners = extract_subshells(text)
            for inner in inners:
                found.extend(calls_in(inner))
            for piece, _, _ in split_commands2(cleaned):
                words = _peel_env(_shell_words(piece))
                argv0, rest = peel_prefix(words)
                if not argv0:
                    continue
                cmd = _dequote(argv0)
                if cmd == "muse" or cmd.endswith("/muse"):
                    found.append((piece, rest))
            return found

        calls = []
        for line in expanded:
            calls.extend(calls_in(line))
        # Whatever still expands at command position is unresolvable
        # statically (conditional assigns, read, $()): fail closed.
        for line in expanded:
            cleaned, _ = extract_subshells(line)
            for piece, _, _ in split_commands2(cleaned):
                words = _peel_env(_shell_words(piece))
                argv0, _ = peel_prefix(words)
                if not argv0:
                    continue
                bare = re.sub(roots, "", _dequote(argv0))
                if "$" in bare or "`" in bare:
                    if "agent-indirect-unresolved" not in drift:
                        drift.append("agent-indirect-unresolved")
        if not calls:
            drift.append("agent-invocation-missing")
        elif len(calls) != 1:
            drift.append(f"agent-invocation-count={len(calls)}")
        else:
            # Scope checks to the simple command containing muse
            # (split_commands2 already bounded it: flags on a later
            # chained command cannot satisfy them). Containment is
            # positional (values never count); the scrub is exact.
            piece, rest = calls[0]
            seen, problem = _parse_muse_argv(
                [_dequote(w) for w in rest])
            if problem == "agent-subcommand":
                drift.append(problem)
            elif "--disable-shell" not in seen:
                drift.append("agent-shell-boundary")
            elif "--disable-write" not in seen:
                drift.append("agent-write-boundary")
            elif problem is not None:
                drift.append(problem)
            scrub = _parse_env_scrub(piece)
            if "GITHUB_TOKEN" not in scrub \
                    or "GH_TOKEN" not in scrub:
                drift.append("agent-token-isolation")
            # Pinned path operands: --workspace roots the
            # agent's file tools (a /proc/self rebind reads
            # environ despite the symlink sweep) and
            # --prompt-file feeds the agent its instructions
            # (a rebound prompt exfils context to Meta). Both
            # are required: CWD is not audited, so a removed
            # --workspace has no verified default.
            vals = _muse_flag_values(
                [_dequote(w) for w in rest])
            works = [v for k, v in vals if k == "--workspace"]
            prompts = [v for k, v in vals
                       if k == "--prompt-file"]
            if any(v != "${GITHUB_WORKSPACE}" for v in works) \
                    or not works:
                if "agent-workspace-rebind" not in drift:
                    drift.append("agent-workspace-rebind")
            if any(v != "${PROMPT_FILE}" for v in prompts) \
                    or not prompts:
                if "agent-promptfile-rebind" not in drift:
                    drift.append("agent-promptfile-rebind")
        _check_model_args(logical, drift)
