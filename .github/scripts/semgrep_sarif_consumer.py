"""Script-consumer guards: resolver output, path literals,
interpreter operands, SCRIPT_DIR bindings, and run-block hygiene
(shell overrides, unpinned actions, substitution/env escapes).
"""
import re
from semgrep_sarif_pins import PINNED_CHECKOUT_USES
from semgrep_sarif_shell import (INTERP_ALLOW, is_step_boundary,
                                 peel_prefix, run_segments,
                                 script_operand, split_commands2,
                                 step_end, step_start, tokenize,
                                 unquote)

def audit_resolver(ctx, drift):
    ctx.resolve = [i for i, line in enumerate(ctx.workflow_lines)
               if re.match(r"^- name:\s*Resolve script directory\s*$",
                           line.strip())]
    if not ctx.resolve:
        drift.append("script-resolution-step-missing")
    else:
        start = ctx.resolve[0]
        span = ctx.workflow_lines[start:step_end(ctx.workflow_lines, start)]
        # The exemption is only valid if executed scripts resolve to
        # the trusted checkout: parse every dir= assignment written to
        # GITHUB_OUTPUT (not mere mentions) and require each value to
        # sit under the trusted tree with no parent traversal.
        # Every assigned value must equal the known trusted path
        # exactly: a contains-check would accept lookalikes such as
        # untrusted-scripts/, and also rules out traversal (..).
        expected = ("${GITHUB_WORKSPACE}/trusted-scripts"
                    "/.github/scripts/muse-review")
        # Every mention of GITHUB_OUTPUT in the resolver must be the
        # known-safe echo of the exact trusted path: the effective
        # dir is the LAST write, so a printf/tee/exec line the old
        # single-spelling collector ignored would silently win. An
        # aliasing line (OUT=$GITHUB_OUTPUT) trips here too, at the
        # alias. Residual: a var name split across expansions.
        safe_echo = re.compile(
            r"""echo\s+["']dir=([^"']+)["']\s*>>\s*"""
            r"""["']?\$?\{?GITHUB_OUTPUT\}?["']?""")
        writes = [line for line in span if "GITHUB_OUTPUT" in line]
        if not writes:
            drift.append("script-resolution-no-output")
        else:
            for line in writes:
                found = safe_echo.search(line)
                if not found or found.group(1).strip() != expected:
                    drift.append("script-resolution-unverified-output")
                    break


def audit_path_literals(ctx, drift):
    # Every executable reference to the review scripts must route
    # through the validated resolver output: a later edit could
    # otherwise hardcode the PR-head scripts path in a token step
    # while the resolver above still looks safe.
    # (a) Path literals live only in the three steps that own the
    # trusted tree (collision-clear, trusted checkout, resolver):
    # consumers name no path (they use ${SCRIPT_DIR}).
    tree_ok = set()
    clear = [i for i, line in enumerate(ctx.workflow_lines)
             if re.match(r"^- name:\s*Clear trusted-scripts collision\s*$",
                         line.strip())]
    if ctx.trusted:
        s = step_start(ctx.workflow_lines, ctx.trusted[0])
        tree_ok.update(range(s, step_end(ctx.workflow_lines, s)))
    if ctx.resolve:
        tree_ok.update(range(ctx.resolve[0],
                             step_end(ctx.workflow_lines, ctx.resolve[0])))
    if clear:
        tree_ok.update(range(clear[0],
                             step_end(ctx.workflow_lines, clear[0])))
    for i, line in enumerate(ctx.workflow_lines):
        if i in tree_ok:
            continue
        if ".github/scripts" in line or "trusted-scripts" in line:
            drift.append("script-consumer-unbound-path")
            break


def audit_invocations(ctx, drift):
    # (b) In run: blocks, every bash/sh/source operand naming a
    # script must route via ${SCRIPT_DIR} (bound in (c) to the
    # resolver output). Flags are parsed (combined shorts, -o
    # args, -- end, redirects); -c/-s/stdin/no-operand drifts.
    ctx.joined = run_segments(ctx.code_lines)
    for seg in ctx.joined:
        # Builtin-qualified (export/local/readonly/declare/typeset,
        # with optional flags) and prefix-assigned rebindings count
        # too: `export SCRIPT_DIR=...` evades a bare-assign match.
        # Residual: read/getopts/printf -v/nameref indirection.
        if re.search(r"(?:^|[;&|])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*"
                     r"(?:(?:export|local|readonly|declare|typeset)\s+"
                     r"(?:-\S+\s+)*)?"
                     r"(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*"
                     r"SCRIPT_DIR\s*=", seg) \
                and "script-dir-rebound" not in drift:
            drift.append("script-dir-rebound")
        nosub = re.sub(r"[A-Za-z_][A-Za-z0-9_]*\(\)\s*\{?", "",
                       seg)
        for piece, _, _ in split_commands2(nosub):
            words = [unquote(t) for t in tokenize(piece)]
            if not words:
                continue
            argv0, rest = peel_prefix(words)
            if argv0 not in INTERP_ALLOW:
                continue
            if not script_operand(rest) \
                    and "script-consumer-unbound-invocation" \
                    not in drift:
                drift.append("script-consumer-unbound-invocation")


def audit_script_dir(ctx, drift):
    # (c) The variable itself: ${SCRIPT_DIR} is only the validated
    # directory if every binding routes via the resolver output.
    # A hardcoded SCRIPT_DIR would launder an untrusted path
    # through check (b).
    for line in ctx.workflow_lines:
        m = re.match(r"^SCRIPT_DIR:\s*(.+)$", line.strip())
        if m and re.sub(r"\s+", "", m.group(1)) != \
                ("${{steps.scriptdir.outputs.dir}}") \
                and "script-dir-rebound" not in drift:
            drift.append("script-dir-rebound")


def audit_run_hygiene(ctx, drift):
    # The whole analyzer assumes bash: a shell: override would
    # silently invalidate every rule below.
    if any(re.match(r"^\s*shell:", line) for line in ctx.workflow_lines):
        drift.append("shell-override")
    # Only the two pinned checkouts may run as actions: a third
    # uses: could smuggle execution past the run:-block rules.
    for line in ctx.workflow_lines:
        m = re.match(r"^uses:\s*(\S+)", line.strip())
        if m and m.group(1) != PINNED_CHECKOUT_USES \
                and "reviewer-unpinned-action" not in drift:
            drift.append("reviewer-unpinned-action")
    # Global run-body forbids: env/path propagation, process
    # substitution, and command substitution execute or persist
    # beyond the per-command rules (every step inherits runner
    # runtime tokens, so even secretless steps can exfiltrate).
    for seg in ctx.joined:
        nosq = re.sub(r"'[^']*'", "''", seg)
        if ("GITHUB_ENV" in nosq or "GITHUB_PATH" in nosq) \
                and "run-body-env-escape" not in drift:
            drift.append("run-body-env-escape")
        if re.search(r"<\(", nosq) \
                and "run-body-process-sub" not in drift:
            drift.append("run-body-process-sub")
        if ("`" in nosq or re.search(r"\$\((?!\()", nosq)) \
                and "run-body-substitution" not in drift:
            drift.append("run-body-substitution")
        # One-line `function f { evil; }` bodies evade operator
        # splitting (argv0 reads `function`), so definitions of
        # either spelling drift everywhere, not just secret steps.
        if re.search(r"function\s+[A-Za-z_][A-Za-z0-9_]*"
                     r"|[A-Za-z_][A-Za-z0-9_]*\(\)", nosq) \
                and "run-body-function-def" not in drift:
            drift.append("run-body-function-def")
