"""Script-consumer guards: resolver output, path literals,
interpreter operands, SCRIPT_DIR bindings, and run-block hygiene
(shell overrides, unpinned actions, substitution/env escapes).
"""
import os
import re
from semgrep_sarif_helpers import (DEFERRED_RE, XTRACE_RE,
                                   _audit_shell_file,
                                   invoked_shell_refs)
from semgrep_sarif_pins import PINNED_CHECKOUT_USES
from semgrep_sarif_programs import (audit_jq_content,
                                    audit_perl_content)
from semgrep_sarif_scan import arith_regions
from semgrep_sarif_shell import (ENV_POISON, INTERP_ALLOW,
                                 map_key_value,
                                 peel_prefix, run_segments,
                                 script_operand, split_commands2,
                                 strip_comments, tokenize,
                                 unquote, unquote_value)
from semgrep_sarif_steps import (is_step_boundary, step_end,
                                 step_name, step_start)

def audit_resolver(ctx, drift):
    ctx.resolve = [i for i, line in enumerate(ctx.workflow_lines)
                   if step_name(line) == "Resolve script directory"]
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
             if step_name(line) == "Clear trusted-scripts collision"]
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
        key, val = map_key_value(line.strip())
        if key == "SCRIPT_DIR" \
                and re.sub(r"\s+", "", unquote_value(val)) != \
                ("${{steps.scriptdir.outputs.dir}}") \
                and "script-dir-rebound" not in drift:
            drift.append("script-dir-rebound")


def audit_run_hygiene(ctx, drift):
    # The whole analyzer assumes bash: a shell: override would
    # silently invalidate every rule below. Quoted ("shell":)
    # counts: quotes do not change YAML semantics.
    if any(map_key_value(line.strip())[0] == "shell"
           for line in ctx.workflow_lines):
        drift.append("shell-override")
    # Only the two pinned checkouts may run as actions: a third
    # uses: — even pinned — could smuggle execution past the run:
    # rules by checking out attacker data into a trusted path.
    # Quoted ("uses":) counts too, with quoted values unquoted.
    checkout_uses = 0
    for line in ctx.workflow_lines:
        key, val = map_key_value(line.strip())
        if key != "uses":
            continue
        first = (unquote_value(val).split() or [""])[0]
        if first != PINNED_CHECKOUT_USES:
            if "reviewer-unpinned-action" not in drift:
                drift.append("reviewer-unpinned-action")
        else:
            checkout_uses += 1
    if checkout_uses != 2 and "reviewer-action-count" not in drift:
        drift.append("reviewer-action-count")
    # Shell-startup, loader, and interpreter-preload vars are
    # inherited by every run: step: a poison var in any YAML env:
    # mapping (job or step level) re-sources the audited blocks from
    # outside their pinned spans. Only contiguous env: blocks (and
    # flow mappings) are scanned, so run:-block text cannot FP.
    # The shared poison list (single source of truth) with quoted
    # keys normalized in both the opener and the block entries.
    idx = 0
    while idx < len(ctx.workflow_lines):
        line = ctx.workflow_lines[idx]
        stripped = line.strip()
        key, val = map_key_value(stripped)
        if key == "env" and val.startswith("{"):
            if any(re.search(r"""["']?\b%s\b["']?\s*:""" % var,
                             stripped)
                   for var in ENV_POISON) \
                    and "reviewer-env-poison" not in drift:
                drift.append("reviewer-env-poison")
            idx += 1
        elif key == "env" and not val:
            base = len(line) - len(line.lstrip(" "))
            idx += 1
            while idx < len(ctx.workflow_lines):
                sub = ctx.workflow_lines[idx]
                if sub.strip() == "" or sub.strip().startswith("#"):
                    idx += 1
                    continue
                if len(sub) - len(sub.lstrip(" ")) <= base:
                    break
                if map_key_value(sub.strip())[0] in ENV_POISON \
                        and "reviewer-env-poison" not in drift:
                    drift.append("reviewer-env-poison")
                idx += 1
        else:
            idx += 1
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
        # Deferred execution: single-quoted text is literal NOW but
        # bash evaluates it LATER through PS4 (under set -x),
        # PROMPT_COMMAND, and $((...)) (proven: PWNED). Reject the
        # binding, the trace switch, and $/backtick in arithmetic.
        if DEFERRED_RE.search(seg) \
                and "run-body-deferred-exec" not in drift:
            drift.append("run-body-deferred-exec")
        if XTRACE_RE.search(nosq) \
                and "run-body-xtrace" not in drift:
            drift.append("run-body-xtrace")
        if any("$" in body or "`" in body
               for body in arith_regions(seg)) \
                and "run-body-arithmetic-sub" not in drift:
            drift.append("run-body-arithmetic-sub")
        # One-line `function f { evil; }` bodies evade operator
        # splitting (argv0 reads `function`), so definitions of
        # either spelling drift everywhere, not just secret steps.
        if re.search(r"function\s+[A-Za-z_][A-Za-z0-9_]*"
                     r"|[A-Za-z_][A-Za-z0-9_]*\(\)", nosq) \
                and "run-body-function-def" not in drift:
            drift.append("run-body-function-def")


def _read_helper(path, drift):
    try:
        with open(path) as fh:
            return fh.read()
    except OSError:
        if "helper-unreadable" not in drift:
            drift.append("helper-unreadable")
        return None


def audit_helpers(ctx, drift):
    helper_dir = ".github/scripts/muse-review/"
    invoked = invoked_shell_refs("\n".join(ctx.code_lines))
    for name in sorted(invoked):
        if not os.path.isfile(helper_dir + name) \
                and "helper-referenced-missing" not in drift:
            drift.append("helper-referenced-missing")
    # Enumerate (not just resolve references): an executable the
    # workflow reaches by another spelling — ranges.pl via perl,
    # the jq -f programs, or any new format — must audit too.
    # Unknown formats fail closed so the auditor learns them first.
    # test.sh is deliberately out of scope: only the tokenless
    # selftest executes it, and trusted-tree-changed still gates
    # its changes for human review.
    try:
        entries = sorted(os.listdir(helper_dir))
    except OSError:
        if "helper-unreadable" not in drift:
            drift.append("helper-unreadable")
        return
    for name in entries:
        if name == "test.sh" or name.endswith(".json"):
            # json is data, never executed (post.sh re-validates).
            continue
        path = helper_dir + name
        if not os.path.isfile(path):
            if "helper-unknown-format" not in drift:
                drift.append("helper-unknown-format")
        elif name.endswith(".sh"):
            _audit_shell_file(path, drift)
        elif name.endswith((".pl", ".jq")):
            text = _read_helper(path, drift)
            if text is None:
                continue
            if name.endswith(".pl"):
                text = "\n".join(strip_comments(line)
                                 for line in text.splitlines())
                audit_perl_content(text, drift)
            else:
                audit_jq_content(text, drift)
        elif "helper-unknown-format" not in drift:
            drift.append("helper-unknown-format")
