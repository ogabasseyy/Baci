"""Checkout ref classification: PR-controlled vs default-branch
vs unresolved refs, with env indirection and YAML-decoded
key/value matching.
"""
import re
from semgrep_sarif_shell import map_key_value, unquote_value


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


def _envmap(ctx):
    if getattr(ctx, "envmap", None) is None:
        ctx.envmap = _collect_env_map(ctx.workflow_lines)
    return ctx.envmap


def _ref_value(line):
    return map_key_value(line.strip())[1]


def is_pr_ref(line):
    # Key-positional: the mapping key must be ref:, so a run: echo
    # of a ref-looking string cannot count as a checkout input.
    # Quoted ("ref":) counts: quotes do not change YAML semantics.
    key, _ = map_key_value(line.strip())
    return key == "ref" and "github.event.pull_request" in line


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
    if "github.event.pull_request" in unquote_value(
            _ref_value(line) or ""):
        return True
    return "github.event.pull_request" in unquote_value(
        _resolve_env_ref(_ref_value(line), envmap) or "")


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
