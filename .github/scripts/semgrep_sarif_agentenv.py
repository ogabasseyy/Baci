"""Agent job/step environment audit: YAML alias splicing plus
token-scope and poison scanning of the agent env blocks.
"""
import re
from semgrep_sarif_segments import run_segments
from semgrep_sarif_shell import (_yaml_double_unescape,
                                map_key_value, strip_comments)
from semgrep_sarif_steps import (_steps_item_indent,
                                 is_step_boundary, step_end,
                                 step_name)


def _splice_yaml_aliases(scan_lines, all_lines):
    # YAML aliases splice anchored content invisibly: env:
    # *agent_env carries the anchor's entries without showing
    # them. Defs (&name in mapping/sequence value position)
    # map to their def line plus deeper-indented block; every
    # *ref in scan value position splices all its def blocks.
    # Iterated to fixpoint (bounded) for nested aliases.
    # Returns (lines, unresolved): unknown refs fail closed.
    anchors = {}
    for i, line in enumerate(all_lines):
        for dm in re.finditer(r"(?:^|[:\-\[,{])\s*&"
                             r"([A-Za-z_][A-Za-z0-9_-]*)",
                             line):
            name = dm.group(1)
            indent = len(line) - len(line.lstrip(" "))
            block = [line]
            for nxt in all_lines[i + 1:]:
                if not nxt.strip():
                    continue
                if len(nxt) - len(nxt.lstrip(" ")) <= indent:
                    break
                block.append(nxt)
            anchors.setdefault(name, []).append(block)
    out = list(scan_lines)
    for _ in range(8):
        grown = False
        for line in list(out):
            for ref in re.findall(
                    r"(?:^|[:\-\[,{])\s*\*"
                    r"([A-Za-z_][A-Za-z0-9_-]*)", line):
                if ref not in anchors:
                    return out, True
                for block in anchors[ref]:
                    for bl in block:
                        if bl not in out:
                            out.append(bl)
                            grown = True
        if not grown:
            return out, False
    return out, True


def audit_agent_env(ctx, drift):
    # The runner scrubs only the two conventional token variable
    # names: a token passed to the agent step under another key (or
    # via job-level env, which the step inherits) would survive into
    # the third-party process. Forbid token expressions in the agent
    # step, in EVERY step that invokes the runner (a second step
    # with an aliased token is the same hole), and in job env.
    token_expr = re.compile(
        r"secrets\s*\.\s*github_token\b"
        r"|secrets\s*\[\s*['\"]github_token['\"]\s*\]"
        r"|secrets\s*\[(?!\s*['\"])"
        r"|github\s*\.\s*token\b"
        r"|github\s*\[\s*['\"]token['\"]\s*\]"
        r"|github\s*\[(?!\s*['\"])"
        r"|toJSON\s*\(\s*github\s*\)"
        r"|toJSON\s*\(\s*secrets\s*\)",
        re.IGNORECASE)
    agent_step = [i for i, line in enumerate(ctx.workflow_lines)
                  if step_name(line) == "Run Muse review"]
    agent_span = []
    if agent_step:
        s = agent_step[0]
        agent_span = ctx.workflow_lines[s:step_end(ctx.workflow_lines, s)]
    else:
        drift.append("agent-step-missing")
    indent = _steps_item_indent(ctx.workflow_lines)
    bounds = [i for i, line in enumerate(ctx.workflow_lines)
              if is_step_boundary(line, indent)] \
        + [len(ctx.workflow_lines)]
    for k in range(len(bounds) - 1):
        span = ctx.workflow_lines[bounds[k]:bounds[k + 1]]
        code = "\n".join(strip_comments(seg)
                         for seg in run_segments(span))
        # Consumer: run-block CODE invoking run.sh (comments
        # stripped, so a "see run.sh" note cannot misfire, and an
        # unbound ./run.sh is already caught elsewhere).
        if "run.sh" in code and bounds[k] not in agent_step:
            agent_span = agent_span + span
    job_env = []
    in_env = False
    for line in ctx.code_lines:
        # Job-level env: is 4-space (jobs.<name>.env); step-level
        # is 8-space and must not start a job-env region. Quoted
        # ("env":) opens a region too. The opener line itself is
        # always scanned: env: *alias and env: {flow} forms
        # carry values on the opener with no block after.
        indented = len(line) - len(line.lstrip(" ")) == 4
        key, val = map_key_value(line.strip()) if indented else (None, None)
        if key == "env":
            job_env.append(line)
            in_env = not val
        elif re.match(r"^  \S|^    \S", line):
            in_env = False
        elif in_env:
            job_env.append(line)
    scan, unresolved = _splice_yaml_aliases(
        agent_span + job_env, ctx.workflow_lines)
    if unresolved and "agent-env-alias" not in drift:
        drift.append("agent-env-alias")
    for line in scan:
        if token_expr.search(line):
            drift.append("agent-token-expression")
            break
    for line in scan:
        # run.sh executes ${HOME}/.local/bin/muse: a HOME
        # binding in agent-inherited env would run a
        # PR-planted binary with META_API_KEY (the sweep
        # removes symlinks, not regular files). Key-
        # positional, plus flow pairs on {-lines (a run:
        # echo mentioning HOME: stays silent).
        key, _ = map_key_value(line.strip())
        if key == "HOME":
            if "agent-env-home" not in drift:
                drift.append("agent-env-home")
            break
        if "{" in line and (
                re.search(r"""["']?HOME["']?\s*:""", line)
                or any(_yaml_double_unescape(m.group(1))
                       == "HOME"
                       for m in re.finditer(
                           r'"((?:[^"\\]|\\.)*)"\s*:', line))):
            # Double-quoted flow keys decode escapes
            # ("\u0048OME" is HOME); plain and
            # single-quoted keys keep backslashes literal,
            # so the raw match above suffices for them.
            if "agent-env-home" not in drift:
                drift.append("agent-env-home")
            break
