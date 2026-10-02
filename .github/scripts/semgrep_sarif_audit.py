"""Checkout guards for the SARIF drift audit: file loading,
PR-controlled checkout count/guard/span/action pin, and the
trusted-scripts checkout (ref, credentials, action, repo).
"""
import re
from semgrep_sarif_pins import AUDITED_PATH, PINNED_CHECKOUT_USES
from semgrep_sarif_shell import (map_key_value, strip_comments,
                                 unquote_value)
from semgrep_sarif_steps import (is_step_boundary, step_end,
                                 step_start)

def load_workflow(path):
    try:
        with open(path) as fh:
            raw_lines = fh.read().splitlines()
    except OSError:
        # Gone from this tree: pr_refs below is empty, so the audit
        # takes the removed-checkout exit (nothing executes the
        # orphaned scripts until a restore PR, which re-audits).
        raw_lines = []
    # Match on code, never comments: a weakened guard that survives
    # only inside a comment must not satisfy the checks below.
    # Block-scalar ref values (ref: >- on its own line) are joined so
    # a folded PR-controlled ref cannot evade the checkout count.
    code_lines = [strip_comments(line) for line in raw_lines]
    # joined[i] carries the raw 0-based index of its first line so SARIF
    # line numbers (raw file numbering) stay comparable after folding.
    workflow_lines = []
    workflow_raw = []
    i = 0
    while i < len(code_lines):
        line = code_lines[i]
        if re.match(r"^\s*ref:\s*[>|][-+]?\s*$", line):
            base = len(line) - len(line.lstrip())
            parts = [line]
            j = i + 1
            while j < len(code_lines) and code_lines[j].strip() \
                    and len(code_lines[j]) - len(code_lines[j].lstrip()) > base:
                parts.append(code_lines[j].strip())
                j += 1
            workflow_lines.append(" ".join(parts))
            workflow_raw.append(i)
            i = j
        else:
            workflow_lines.append(line)
            workflow_raw.append(i)
            i += 1

    return code_lines, workflow_lines, workflow_raw


def job_if_bodies(ref_raw_index, code_lines):
    # Conditions of the audited step's own job only: a matching
    # guard string in another job, a step, or a run: block must
    # not satisfy the check. Returns None when unlocatable.
    jobs_at = next(
        (i for i, line in enumerate(code_lines)
         if map_key_value(line.strip())[0] == "jobs"
         and not map_key_value(line.strip())[1]), None)
    if jobs_at is None or ref_raw_index <= jobs_at:
        return None
    job_at = next(
        (i for i in range(ref_raw_index, jobs_at, -1)
         if re.match(r"^  \S+:\s*$", code_lines[i])), None)
    if job_at is None:
        return None
    def is_steps(line):
        if len(line) - len(line.lstrip(" ")) != 4:
            return False
        key, val = map_key_value(line.strip())
        return key == "steps" and not val

    steps_at = next(
        (i for i in range(job_at + 1, len(code_lines))
         if is_steps(code_lines[i])
         or re.match(r"^  \S+:\s*$", code_lines[i])),
        len(code_lines))
    bodies = []
    i = job_at + 1
    while i < steps_at:
        line = code_lines[i]
        indented = len(line) - len(line.lstrip(" ")) == 4
        key, val = map_key_value(line.strip()) if indented else (None, None)
        if key != "if":
            i += 1
            continue
        block = re.match(r"^[>|][-+]?\s*$", val)
        single = re.match(r"^(\S.*)$", val)
        if block:
            j = i + 1
            while j < steps_at and code_lines[j].strip() \
                    and len(code_lines[j]) - len(code_lines[j].lstrip()) > 4:
                bodies.append(code_lines[j].strip())
                j += 1
            i = j
        elif single:
            bodies.append(single.group(1))
            i += 1
        else:
            i += 1
    return bodies

def _norm_ref_value(value):
    rest = re.sub(r"^[>|][-+]?\s*", "", value.strip())
    return re.sub(r"\s+", "", unquote_value(rest))


def _collect_env_map(lines):
    # Every env: block (workflow/job/step level): NAME -> raw
    # value. Indent-scoped: entries end at the first line at or
    # above the opener's indent. Flow mappings (env: {A: b})
    # stay unparsed: an alias hidden there cannot resolve, so a
    # ref through it fails closed as unresolved below.
    envmap, i, n = {}, 0, len(lines)
    while i < n:
        key, val = map_key_value(lines[i].strip())
        if key == "env" and not val:
            indent = len(lines[i]) - len(lines[i].lstrip(" "))
            i += 1
            while i < n:
                line = lines[i]
                if not line.strip():
                    i += 1
                    continue
                if len(line) - len(line.lstrip(" ")) <= indent:
                    break
                k, v = map_key_value(line.strip())
                if k:
                    envmap[k] = v
                i += 1
        else:
            i += 1
    return envmap


def _resolve_env_ref(value, envmap):
    # Substitute ${{ env.NAME }} aliases (bounded chase for
    # env-to-env chains); unknown names stay literal so the
    # caller fails closed on the remaining expression.
    value = value or ""
    for _ in range(8):
        m = re.search(r"\$\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)"
                      r"\s*\}\}", value)
        if not m or m.group(1) not in envmap:
            return value
        value = value[:m.start()] + envmap[m.group(1)] \
            + value[m.end():]
    return value


def is_pr_ref(line):
    # Key-positional: the mapping key must be ref:, so a run: echo
    # of a ref-looking string cannot count as a checkout input.
    # Quoted ("ref":) counts: quotes do not change YAML semantics.
    key, _ = map_key_value(line.strip())
    return key == "ref" and "github.event.pull_request" in line


def _envmap(ctx):
    if getattr(ctx, "envmap", None) is None:
        ctx.envmap = _collect_env_map(ctx.workflow_lines)
    return ctx.envmap


def _ref_value(line):
    return map_key_value(line.strip())[1]


def ref_is_pr_controlled(line, envmap):
    # A literal PR expression, or an env alias resolving to one
    # (REVIEW_REF: ${{ ...head.sha }} + ref: ${{ env.REVIEW_REF }}
    # is the same checkout and must keep its guards, not take
    # the removed-checkout early return).
    key, _ = map_key_value(line.strip())
    if key != "ref":
        return False
    if "github.event.pull_request" in line:
        return True
    return "github.event.pull_request" in _resolve_env_ref(
        _ref_value(line), envmap)


def ref_is_unresolved(line, envmap):
    # An expression-valued ref that is neither PR-controlled
    # (literal or aliased) nor the exact default-branch shape:
    # a runtime value (steps outputs, vars, functions) whose
    # target the audit cannot verify fails closed.
    key, _ = map_key_value(line.strip())
    if key != "ref":
        return False
    value = _ref_value(line) or ""
    if "${{" not in value:
        return False
    if ref_is_pr_controlled(line, envmap):
        return False
    return _norm_ref_value(value) != (
        "${{github.event.repository.default_branch}}")


def cred_ok(line):
    key, val = map_key_value(line.strip())
    return key == "persist-credentials" \
        and unquote_value(val) == "false"


def find_pr_refs(ctx, drift):
    # Aliased PR refs count (their guards still apply).
    # Expression-valued refs resolving to neither a PR
    # expression nor the default-branch shape count too (a
    # nonconstant checkout needs PR-grade guards, never the
    # removed-checkout early return) AND drift, so the label
    # prints on the normal path instead of the generic
    # no-checkout message.
    envmap = _envmap(ctx)
    ctx.pr_refs = [i for i, line in enumerate(ctx.workflow_lines)
                   if ref_is_pr_controlled(line, envmap)
                   or ref_is_unresolved(line, envmap)]
    if any(ref_is_unresolved(line, envmap)
           for line in ctx.workflow_lines) \
            and "pr-ref-unresolved" not in drift:
        drift.append("pr-ref-unresolved")
    return ctx.pr_refs


def audit_pr_checkout(ctx, drift):
    if len(ctx.pr_refs) != 1:
        drift.append(f"pr-controlled-checkout-count={len(ctx.pr_refs)}")
    guard_bodies = (job_if_bodies(ctx.workflow_raw[ctx.pr_refs[0]], ctx.code_lines)
                    if len(ctx.pr_refs) == 1 else None)
    # The guard must be a positive top-level && conjunct of the job
    # condition with no top-level || branch: mere presence would also
    # accept !(guard) or a lookalike, and `(guard && ...) || true` is
    # unconditionally true despite containing the conjunct. Redundant
    # outer parens are tolerated; anything else fails closed. A ||
    # nested inside parens (e.g. the action/edited fallback) stays a
    # restriction, so only depth-0 disjunction drifts.
    guard_expr = ("github.event.pull_request.head.repo.full_name"
                  " == github.repository")

    def is_guarded(condition):
        parts, depth, buf = [], 0, ""
        quote, i = None, 0
        while i < len(condition):
            ch = condition[i]
            if quote:
                buf += ch
                if ch == quote:
                    quote = None
                i += 1
            elif ch in ("'", '"'):
                quote, buf, i = ch, buf + ch, i + 1
            elif ch == "(":
                depth, buf, i = depth + 1, buf + ch, i + 1
            elif ch == ")":
                depth, buf, i = max(0, depth - 1), buf + ch, i + 1
            elif ch == "|" and condition[i:i + 2] == "||" \
                    and depth == 0:
                return False
            elif ch == "&" and condition[i:i + 2] == "&&" \
                    and depth == 0:
                parts.append(buf)
                buf, i = "", i + 2
            else:
                buf, i = buf + ch, i + 1
        parts.append(buf)
        for part in parts:
            piece = " ".join(part.split())
            while len(piece) >= 2 and piece.startswith("(") \
                    and piece.endswith(")"):
                level, matched = 0, True
                for pos, c in enumerate(piece):
                    if c == "(":
                        level += 1
                    elif c == ")":
                        level -= 1
                        if level == 0 and pos != len(piece) - 1:
                            matched = False
                            break
                if not matched or level != 0:
                    break
                piece = piece[1:-1].strip()
            if piece == guard_expr:
                return True
        return False

    if len(ctx.pr_refs) == 1 and not (
            guard_bodies and is_guarded(" ".join(guard_bodies))):
        drift.append("same-repo-job-guard")
    # 1-based inclusive raw line span of the audited checkout step, used
    # to pin the SARIF exemption to this exact finding (see below).
    # (Count drift is recorded above; a non-unique ref leaves the span
    # empty so the predicate below cannot match anything.)
    ctx.span = (0, 0)
    if len(ctx.pr_refs) == 1:
        start = step_start(ctx.workflow_lines, ctx.pr_refs[0])
        raw_start = ctx.workflow_raw[start]
        raw_end = step_end(ctx.code_lines, ctx.workflow_raw[ctx.pr_refs[0]])
        # Trim trailing blank separator lines so the span ends at
        # the step's last content line (not the next step's own).
        while raw_end - 1 > raw_start \
                and not ctx.code_lines[raw_end - 1].strip():
            raw_end -= 1
        ctx.span = (raw_start + 1, raw_end)
        # Key-positional: a run: echo of the string must not satisfy it.
        if not any(cred_ok(line)
                   for line in ctx.workflow_lines[start:ctx.pr_refs[0]]):
            drift.append("head-checkout-credentials")
        # The step runs with the job's PR write token before the
        # secret-bearing steps: pin its exact action, not just the
        # ref it checks out. A mutable action ref could persist
        # code into the later steps while the ref still audits.
        audited_span = ctx.workflow_lines[
            start:step_end(ctx.workflow_lines, start)]
        audited_uses = [
            unquote_value(map_key_value(line.strip())[1])
            for line in audited_span
            if map_key_value(line.strip())[0] == "uses"]
        if not audited_uses or not all(
                value == PINNED_CHECKOUT_USES
                for value in audited_uses):
            drift.append("head-checkout-action")
        # The audited step checks out the head into the default
        # workspace for the agent to read: a path:/repository: key
        # would relocate or re-source that data while the ref still
        # audits, silently changing what gets reviewed.
        if any(map_key_value(line.strip())[0]
               in ("repository", "path")
               for line in audited_span):
            drift.append("head-checkout-shape")


def audit_trusted_checkout(ctx, drift):
    def trusted_here(line):
        key, val = map_key_value(line.strip())
        return key == "path" \
            and unquote_value(val) == "trusted-scripts"

    ctx.trusted = [i for i, line in enumerate(ctx.workflow_lines)
                   if trusted_here(line)]
    if not ctx.trusted:
        drift.append("trusted-scripts-checkout-missing")
    else:
        start = step_start(ctx.workflow_lines, ctx.trusted[0])
        span = ctx.workflow_lines[start:step_end(ctx.workflow_lines, start)]
        # The trusted checkout's own ref: inputs must equal the
        # audited default-branch expression exactly (whitespace
        # aside): a contains-check would accept PR-controlled
        # lookalikes such as default_branch && github.head_ref.
        # Credentials must stay disabled: a persisted token in the
        # nested repo's git config is file content the workspace-
        # reading agent could exfiltrate under prompt injection.
        expected_ref = "${{github.event.repository.default_branch}}"

        ref_values = [
            _norm_ref_value(map_key_value(line.strip())[1])
            for line in span
            if map_key_value(line.strip())[0] == "ref"]
        if not ref_values or not all(
                value == expected_ref for value in ref_values):
            drift.append("trusted-scripts-default-branch")
        if not any(cred_ok(line) for line in span):
            drift.append("trusted-scripts-credentials")
        if any(ref_is_pr_controlled(line, _envmap(ctx))
               for line in span):
            drift.append("trusted-scripts-pr-ref")
        # The step is located by path: alone, so pin the action and
        # forbid repository:: either would otherwise silently
        # re-source the executable tree the token-bearing steps run.
        uses_values = [
            unquote_value(map_key_value(line.strip())[1])
            for line in span
            if map_key_value(line.strip())[0] == "uses"]
        if not uses_values or not all(
                value == PINNED_CHECKOUT_USES
                for value in uses_values):
            drift.append("trusted-scripts-action")
        if any(map_key_value(line.strip())[0] == "repository"
               for line in span):
            drift.append("trusted-scripts-repository")
