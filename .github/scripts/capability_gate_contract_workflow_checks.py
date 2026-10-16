"""Contract-workflow checks (no pins, pure parsing).

Companion to capability_gate_contract_check.py, executed base-owned via the
archived extraction alongside it. Everything here reads candidate text as
data; nothing here executes PR code.
"""
import re

from capability_gate_contract_ci_checks import (
    CHECKER,
    WORKFLOW,
    _TRIGGER_ITEM,
    _has_escaped_key,
    _on_block_subs,
    _ordered_branch_match,
    _strip_comment,
    _without_block_scalars,
)

# The gate job's run block, stripped per line. Any edit fails until this expectation is updated alongside it; that update cannot take effect same-PR (the running checker is base-owned), so run-block changes need two PRs.
EXPECTED_RUN = [
    'if [ -n "${{ github.event.pull_request.head.sha }}" ]; then',
    "rm -rf /tmp/cg-check && mkdir -p /tmp/cg-check",
    'git fetch --no-tags --depth 1 origin "${{ github.base_ref }}"',
    "git archive FETCH_HEAD .github/scripts/capability_gate_contract_check.py .github/scripts/capability_gate_contract_ci_checks.py .github/scripts/capability_gate_contract_workflow_checks.py | tar -x -C /tmp/cg-check",
    "CHECKER=/tmp/cg-check/.github/scripts/capability_gate_contract_check.py",
    "else",
    "CHECKER=.github/scripts/capability_gate_contract_check.py",
    "fi",
    'python3 "$CHECKER" "$PINNED_CHECKER_SHA256"',
]

# The gate job's first step, stripped per line: the checkout's identity, its effective with.ref, and its data-only unsafety opt-in are all pinned.
EXPECTED_FIRST_STEP = [
    "- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    "with:",
    "ref: ${{ github.event.pull_request.head.sha }}",
    "fetch-depth: 1",
    "persist-credentials: false",
    "allow-unsafe-pr-checkout: true",
]

# Each job runs exactly in its safe context (guard on pull_request_target, attestation on push): the mapping is exact, not an allowlist.
EXPECTED_JOB_CONDITIONS = {
    "gate-contract": "github.event_name == 'pull_request_target'",
    "gate-attestation": "github.event_name == 'push'",
}

# Required checks are named by job name and a skipped job still reports success: swapping names would let the attestation satisfy the guard's context.
EXPECTED_JOB_NAMES = {
    "gate-contract": "Capability Gate Contract",
    "gate-attestation": "Capability Gate Contract Attestation",
}

# The attestation is never trusted, but its same-named context must not be rewritable: pin its steps exactly.
EXPECTED_ATTESTATION_STEPS = [
    "- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    "with:",
    "fetch-depth: 1",
    "persist-credentials: false",
    "- name: Attest merged enforcement pins",
    "shell: bash",
    'run: python3 .github/scripts/capability_gate_contract_check.py "$PINNED_CHECKER_SHA256"',
]

_JOB_HEADER = re.compile(r"^  ([A-Za-z0-9_.\-]+)\s*:")


def contract_trigger_failures(workflow_text):
    """The guard's own triggers must stay unwidened: narrowed types/branches keep the key while silencing updates or main PRs."""
    lines = _without_block_scalars(workflow_text.splitlines())
    subs, end = _on_block_subs(lines)
    if subs is None:
        return ["contract workflow must declare triggers"]
    failures = []
    if "pull_request_target" not in subs:
        return ["contract workflow must keep the pull_request_target trigger"]
    on_at = next(i for i, line in enumerate(lines) if line == "on:")
    for line in lines[on_at + 1 : end]:
        inline = re.match(r"^  (pull_request_target|push)\s*:\s*(.*)$", line)
        if inline and _strip_comment(inline.group(2)).strip():
            failures.append(f"contract workflow must not carry inline {inline.group(1)} trigger filters:")
    for key, rest, idx in subs["pull_request_target"]:
        if key in ("paths", "paths-ignore", "branches-ignore"):
            failures.append(f"contract workflow must not narrow pull_request_target with {key}:")
        if key == "types":
            got = [rest] if rest.strip() else []
            j = idx + 1
            while j < end:
                item = _TRIGGER_ITEM.match(lines[j])
                if not item:
                    break
                got.append(item.group(1))
                j += 1
            want = {"opened", "synchronize", "reopened", "edited"}
            clean = [_strip_comment(raw) for raw in got]
            have = {part.strip().strip("'\"") for raw in clean for part in raw.strip().strip("[]").split(",") if part.strip()}
            if not want <= have:
                failures.append("contract workflow must keep the full pull_request_target types:")
    if _ordered_branch_match(subs, "pull_request_target", lines, end) is False:
        failures.append("contract workflow must keep an exact main match in pull_request_target branches:")
    # The push attestation must only ever run on main: a bare push trigger
    # lets any branch push mint the same-named context self-attested.
    if "push" not in subs:
        failures.append("contract workflow must keep the push trigger")
    else:
        for key, rest, idx in subs["push"]:
            if key in ("paths", "paths-ignore", "branches-ignore", "types"):
                failures.append(f"contract workflow must not narrow push with {key}:")
        # Exact push scope, canonically spelled: inclusion globs ([main, attacker], ['*']) still match main.
        lone = [(rest, idx) for key, rest, idx in subs["push"] if key == "branches"]
        if len(lone) != 1 or re.sub(r"[\s\"']", "", _strip_comment(lone[0][0]).strip()) != "[main]":
            failures.append("contract workflow must scope push to exactly branches: [main]:")
    # Exact trigger set: extra triggers mint same-named skipped contexts; merge_group stays excluded (queue commits would deadlock on the PRT-gated context).
    if set(subs) != {"pull_request_target", "push"}:
        failures.append("contract workflow must keep exactly the pull_request_target and push triggers:")
    return failures


def workflow_failures(workflow_text):
    """The contract workflow must keep executing base-owned logic, exactly.

    The run block is compared line for line: an added executable step, an
    added uses: step, a dropped fetch, a retargeted checkout, or head-owned
    execution all fail. Jobs, conditions, steps, and permissions are
    asserted structurally. Comment lines never execute, so none of them can
    satisfy a check.
    """
    raw = [line for line in workflow_text.splitlines() if line.strip() and not line.strip().startswith("#")]
    code = _without_block_scalars(raw)
    failures = contract_trigger_failures(workflow_text)
    if any(re.match(r"""^"[^"\n]*\\[^"\n]*"\s*:""", line) for line in code):
        failures.append("contract workflow keys must use plain spelling: escapes execute decoded")
    # Top-level permissions must be exactly read-only: a substring match
    # would accept a write-all mapping hiding beside a decoy string.
    try:
        perms = next(i for i, line in enumerate(code) if line == "permissions:")
    except StopIteration:
        failures.append("contract workflow must declare top-level permissions")
        perms = None
    if perms is not None:
        entries = []
        for line in code[perms + 1 :]:
            if len(line) - len(line.lstrip()) < 2:
                break
            entries.append(line.strip())
        if entries != ["contents: read"]:
            failures.append("contract workflow top-level permissions must stay exactly read-only")
    # Exactly the two known jobs: an appended job with its own uses: actions
    # and permissions would otherwise evade every scoped check.
    try:
        jobs_at = next(i for i, line in enumerate(code) if line == "jobs:")
    except StopIteration:
        return failures + ["contract workflow must declare jobs"]
    names = [m.group(1) for line in code[jobs_at + 1 :] if (m := re.match(r"^  ([A-Za-z0-9_.\-]+)\s*:", line))]
    if set(names) != set(EXPECTED_JOB_CONDITIONS):
        return failures + [f"contract workflow must keep exactly its guard jobs (found {sorted(set(names))})"]
    gate = next(i for i, line in enumerate(code) if re.match(r"^  gate-contract\s*:", line))
    later = [i for i in range(len(code)) if i > gate and re.match(r"^  [A-Za-z0-9_.\-]+\s*:", code[i])]
    stop = later[0] if later else len(code)
    block = code[gate:stop]
    rawblock = raw[gate:stop]
    # Each job runs exactly in its safe context (guard on pull_request_target,
    # attestation on push): anything else fails, so the required status is exact.
    for job, want in EXPECTED_JOB_CONDITIONS.items():
        at = next(i for i, line in enumerate(code) if re.match(rf"^  {job}\s*:", line))
        following = [i for i in range(len(code)) if i > at and re.match(r"^  [A-Za-z0-9_.\-]+\s*:", code[i])]
        slice_ = code[at : (following[0] if following else len(code))]
        conds = [
            (m.group(1), m.group(2))
            for line in slice_
            if (m := re.match(r"^    [\"']?(if|needs|continue-on-error)[\"']?\s*:\s*(.*)$", line))
        ]
        if ("if", want) not in conds or len([c for c, _ in conds if c == "if"]) != 1:
            failures.append(f"contract workflow {job} job must run only on its safe event")
    for job, want_name in EXPECTED_JOB_NAMES.items():
        at = next(i for i, line in enumerate(code) if re.match(rf"^  {job}\s*:", line))
        following = [i for i in range(len(code)) if i > at and re.match(r"^  [A-Za-z0-9_.\-]+\s*:", code[i])]
        slice_ = code[at : (following[0] if following else len(code))]
        names = [m.group(1).strip().strip("\"'") for line in slice_ if (m := re.match(r"^    name\s*:\s*(.*)$", line))]
        if names != [want_name]:
            failures.append(f"contract workflow {job} job must keep its guard status name")
    att = next(i for i, line in enumerate(code) if re.match(r"^  gate-attestation\s*:", line))
    att_steps = [line.strip() for line in code[att:] if line.strip() and not line.strip().startswith("#")]
    try:
        att_steps = att_steps[att_steps.index("steps:") + 1 :]
    except ValueError:
        return failures + ["contract workflow attestation must keep exactly its pinned steps"]
    if att_steps != EXPECTED_ATTESTATION_STEPS:
        failures.append("contract workflow attestation must keep exactly its pinned steps")
    conds = [(m.group(1), m.group(2)) for line in block if (m := re.match(r"^    [\"']?(if|needs|continue-on-error)[\"']?\s*:\s*(.*)$", line))]
    if any(c in ("needs", "continue-on-error") for c, _ in conds):
        failures.append("contract workflow gate job must stay unconditional")
    # The checker baseline must live where it propagates (top-level or gate
    # job env): a step-scoped entry never reaches the sibling run step.
    top_env = next((i for i, line in enumerate(code) if re.match(r"""^["']?env["']?:""", line)), None)
    live_pin = False
    if top_env is not None:
        flow = re.match(r"""^["']?env["']?:\s*(.*)$""", code[top_env]).group(1)
        if _strip_comment(flow).strip():
            failures.append("contract workflow top-level env must use block mapping (no inline filters)")
        else:
            for line in code[top_env + 1 :]:
                if len(line) - len(line.lstrip()) < 2:
                    break
                if re.match(r"^\s*PINNED_CHECKER_SHA256:\s*[0-9a-f]{64}\s*$", line):
                    live_pin = True
                else:
                    failures.append("contract workflow top-level env must carry only the checker pin")
                    break
    for line in block:
        if re.match(r"^      PINNED_CHECKER_SHA256:\s*[0-9a-f]{64}\s*$", line):
            live_pin = True
    if not live_pin:
        failures.append("contract workflow must declare its checker pin where it propagates (top-level or gate job env)")
    for line in block:
        if re.match(r"^        [\"']?(if|continue-on-error)[\"']?\s*:", line):
            failures.append("contract workflow steps must stay unconditional")
            break
    if any(re.match(r"^\s*[\"']?permissions[\"']?\s*:", line) for line in block):
        failures.append("contract workflow job must not override permissions")
    # A container image swaps the python3/tar/git that execute the
    # base-owned sequence for PR-selected binaries.
    for line in block:
        if re.match(r"^    [\"']?container[\"']?\s*:", line):
            failures.append("contract workflow job must not run in a PR-selected container")
            break
    steps = [i for i, line in enumerate(block) if re.match(r"^      -(\s|$)", line)]
    if len(steps) != 2:
        return failures + [f"contract workflow job must keep exactly its two steps (found {len(steps)})"]
    first = [block[steps[0]].strip()]
    for line in block[steps[0] + 1 : steps[1]]:
        if line.strip() and not line.strip().startswith("#"):
            first.append(line.strip())
    if first != EXPECTED_FIRST_STEP:
        failures.append("contract workflow first step must stay the pinned data-only checkout")
    runs = [i for i, line in enumerate(block) if re.match(r"^\s*run\s*:", line)]
    if len(runs) != 1:
        return failures + [f"contract workflow must have exactly one run step (found {len(runs)})"]
    if not re.match(r"^\s*run\s*:\s*\|\s*$", block[runs[0]]):
        return failures + ["contract workflow run step must stay a block run"]
    indent = len(block[runs[0]]) - len(block[runs[0]].lstrip())
    body = []
    for line in rawblock[runs[0] + 1 :]:
        stripped = line.strip()
        if len(line) - len(line.lstrip()) <= indent:
            break
        body.append(stripped)
    if body != EXPECTED_RUN:
        failures.append("contract workflow run block must stay exactly the pinned base-owned sequence")
    # Startup env preloads PR code before the checker starts: job env carries only the pin, steps none.
    for line in block:
        if _has_escaped_key(line):
            failures.append("contract workflow keys must use plain spelling (no escapes)")
            break
    env_open = False
    for line in block:
        envm = re.match(r"^    [\"']?env[\"']?\s*:\s*(.*)$", line)
        if envm:
            if _strip_comment(envm.group(1)).strip():
                failures.append("contract workflow job env must use block mapping (no inline filters)")
                break
            env_open = True
            continue
        if env_open:
            if re.match(r"^      \S", line):
                if not re.match(r"^      PINNED_CHECKER_SHA256:\s*[0-9a-f]{64}\s*$", line):
                    failures.append("contract workflow job env must carry only the checker pin")
                    break
                continue
            env_open = False
        if re.match(r"^        [\"']?env[\"']?\s*:", line):
            failures.append("contract workflow steps must not set environment")
            break
    # Steps must run their scripts with the default shell: a custom shell
    # template can ignore {0} and report success without executing them.
    for line in block:
        shell = re.match(r"^        [\"']?shell[\"']?\s*:\s*(.*)$", line)
        if shell and _strip_comment(shell.group(1)).strip() != "bash":
            failures.append("contract workflow steps must keep the default shell (custom templates can skip the script)")
            break
    return failures
